import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { setDashboardAuthCookie, createDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { isSamlConfigured } from "@/lib/auth/saml.js";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { isLocalRequest } from "@/dashboardGuard";
import { verifyUserPassword, recordUserLogin } from "@/lib/db/repos/usersRepo.js";
import { getMembershipsForUser } from "@/lib/db/repos/membershipsRepo.js";
import { verifySuperadminPassword, getSuperadminByUsername } from "@/lib/db/repos/superadminsRepo.js";

const RESET_HINT = "Forgot password? Reset via CLI or contact platform administrator.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s. ${RESET_HINT}`, retryAfter: lock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    const body = await request.json();
    const { email, username, password } = body || {};

    if (!password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    const settings = await getSettings();

    // Block login via tunnel/tailscale if dashboard access is disabled
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    const identifier = (email || username || "").trim();

    // 1. Try User Login (email + password)
    if (identifier && identifier.includes("@")) {
      const user = await verifyUserPassword(identifier, password);
      if (user) {
        recordSuccess(ip);
        await recordUserLogin(user.id);

        const memberships = await getMembershipsForUser(user.id);
        const firstOrg = memberships[0] || null;
        const activeOrgId = firstOrg ? firstOrg.orgId : null;
        const role = firstOrg ? firstOrg.role : "member";

        const claims = {
          userId: user.id,
          email: user.email,
          displayName: user.display_name,
          activeOrgId,
          role,
        };

        let token = null;
        try {
          const cookieStore = await cookies();
          token = await setDashboardAuthCookie(cookieStore, request, claims);
        } catch {
          token = await createDashboardAuthToken(claims);
        }

        return NextResponse.json(
          {
            success: true,
            isSuperadmin: false,
            token,
            user: { id: user.id, email: user.email, displayName: user.display_name },
            activeOrgId,
            role,
            organizations: memberships.map((m) => ({
              id: m.orgId,
              name: m.orgName,
              role: m.role,
              status: m.orgStatus,
            })),
            mustChangePassword: false,
          },
          { headers: NO_STORE_HEADERS }
        );
      }
    }

    // 2. Superadmin or Single-Field Password Login
    let isSuperadminValid = false;
    if (!identifier || identifier.toLowerCase() === "admin") {
      isSuperadminValid = await verifySuperadminPassword("admin", password);
    }

    // Fallback: check stored settings password if superadmin password failed and no identifier
    if (!isSuperadminValid && !identifier && settings.password) {
      isSuperadminValid = await bcrypt.compare(password, settings.password);
    }

    // Fallback: check initial password
    if (!isSuperadminValid && !identifier && !settings.password) {
      const initialPassword = process.env.SUPERADMIN_PASSWORD || process.env.INITIAL_PASSWORD || "123456";
      isSuperadminValid = (password === initialPassword);
    }

    if (isSuperadminValid) {
      recordSuccess(ip);

      // CVE-2026-56679 mitigation: Default password still in use on remote client
      const superadminRecord = await getSuperadminByUsername("admin");
      const defaultPasswordUsed = password === "123456";
      const mustChangePassword =
        defaultPasswordUsed &&
        !process.env.INITIAL_PASSWORD &&
        !process.env.SUPERADMIN_PASSWORD &&
        !isLocalRequest(request);

      if (mustChangePassword) {
        return NextResponse.json(
          {
            success: false,
            error: "Default password must be changed before remote access. Change it from the local machine (or set INITIAL_PASSWORD).",
            mustChangePassword: true,
          },
          { status: 403, headers: NO_STORE_HEADERS }
        );
      }

      const adminClaims = {
        isSuperadmin: true,
        username: "admin",
      };

      let token = null;
      try {
        const cookieStore = await cookies();
        token = await setDashboardAuthCookie(cookieStore, request, adminClaims);
      } catch {
        token = await createDashboardAuthToken(adminClaims);
      }

      return NextResponse.json(
        {
          success: true,
          isSuperadmin: true,
          username: "admin",
          token,
          mustChangePassword: false,
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    // Login failed
    const { remainingBeforeLock } = recordFail(ip);
    const postLock = checkLock(ip);
    if (postLock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } }
      );
    }

    return NextResponse.json(
      { error: `Invalid credentials. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message || "Login failed" }, { status: 500 });
  }
}
