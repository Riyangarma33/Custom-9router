import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createUser } from "@/lib/db/repos/usersRepo.js";
import { redeemInvitation } from "@/lib/db/repos/invitationsRepo.js";
import { createOrganization } from "@/lib/db/repos/organizationsRepo.js";
import { addMembership } from "@/lib/db/repos/membershipsRepo.js";
import { setDashboardAuthCookie, createDashboardAuthToken } from "@/lib/auth/dashboardSession";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, password, displayName, invitationCode } = body || {};

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    let user;
    try {
      user = await createUser({
        email,
        password,
        displayName,
        authSource: "local",
      });
    } catch (err) {
      if (err.code === "USER_EXISTS") {
        return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
      }
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    let activeOrgId = null;
    let role = "member";

    // If an invitation code was provided, join the invited org directly
    if (invitationCode && typeof invitationCode === "string" && invitationCode.trim()) {
      try {
        const redeemRes = await redeemInvitation(invitationCode.trim(), user.id);
        activeOrgId = redeemRes.orgId;
        role = redeemRes.role;
      } catch (invErr) {
        return NextResponse.json(
          {
            success: true,
            user: { id: user.id, email: user.email, displayName: user.display_name },
            activeOrgId: null,
            invitationError: invErr.message,
          },
          { status: 201, headers: NO_STORE_HEADERS }
        );
      }
    } else {
      // Solo signup bootstrapping: auto-provision personal workspace for solo use
      try {
        const workspaceName = `${user.display_name || user.email.split("@")[0]}'s Workspace`;
        const personalOrg = await createOrganization({
          name: workspaceName,
          plan_tier: "free",
          pay_as_you_go_ceiling: 0.0,
          created_by: "system_auto_signup",
        });
        await addMembership({
          userId: user.id,
          orgId: personalOrg.id,
          role: "org_admin",
          invitedBy: "system",
        });
        activeOrgId = personalOrg.id;
        role = "org_admin";
      } catch (wsErr) {
        console.warn("Failed to auto-provision workspace for user:", wsErr);
      }
    }

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
        user: { id: user.id, email: user.email, displayName: user.display_name },
        activeOrgId,
        role,
        token,
      },
      { status: 201, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to create account" }, { status: 500 });
  }
}
