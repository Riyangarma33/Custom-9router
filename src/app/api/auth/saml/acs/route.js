import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import {
  getSamlBaseUrl,
  isSamlConfigured,
  pickSamlDisplayName,
  pickSamlEmail,
  validateSamlResponse,
} from "@/lib/auth/saml.js";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { upsertSsoUser } from "@/lib/db/repos/usersRepo.js";
import { getMembershipsForUser } from "@/lib/db/repos/membershipsRepo.js";

export async function POST(request) {
  const settings = await getSettings();
  const origin = getSamlBaseUrl(request, settings);
  const ip = getClientIp(request);

  const lock = checkLock(ip);
  if (lock.locked) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(`Too many failed attempts. Try again in ${lock.retryAfter}s.`)}`,
        origin
      )
    );
  }

  const cookieStore = await cookies();
  const storedRequestId = cookieStore.get("saml_state")?.value || "";

  // Always clear saml_state cookie after attempt
  cookieStore.delete("saml_state");

  try {
    const formData = await request.formData();
    const SAMLResponse = formData.get("SAMLResponse");

    if (!SAMLResponse) {
      recordFail(ip);
      return NextResponse.redirect(new URL("/login?error=saml_missing_response", origin));
    }

    if (!isSamlConfigured(settings)) {
      recordFail(ip);
      return NextResponse.redirect(new URL("/login?error=saml_not_configured", origin));
    }

    const profile = await validateSamlResponse(request, { SAMLResponse }, storedRequestId, settings);

    const samlEmail = pickSamlEmail(profile, settings) || "saml-user@saml.local";
    const samlName = pickSamlDisplayName(profile, settings) || "SAML user";

    recordSuccess(ip);

    // Persist real user row in users table
    const user = await upsertSsoUser({
      email: samlEmail,
      displayName: samlName,
      authSource: "saml",
    });

    // Check user org memberships
    const memberships = await getMembershipsForUser(user.id);
    const firstOrg = memberships[0] || null;
    const activeOrgId = firstOrg ? firstOrg.orgId : null;
    const role = firstOrg ? firstOrg.role : "member";

    await setDashboardAuthCookie(cookieStore, request, {
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      activeOrgId,
      role,
      saml: true,
      samlEmail,
      samlName,
    });

    return NextResponse.redirect(new URL("/dashboard", origin));
  } catch (error) {
    recordFail(ip);
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message || "saml_acs_failed")}`, origin)
    );
  }
}
