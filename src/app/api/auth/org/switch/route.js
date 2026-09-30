import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveCallerContext } from "@/lib/auth/rbac";
import { getMembership } from "@/lib/db/repos/membershipsRepo.js";
import { setDashboardAuthCookie, createDashboardAuthToken } from "@/lib/auth/dashboardSession";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request) {
  try {
    const ctx = await resolveCallerContext(request);
    if (!ctx.authenticated || !ctx.userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json();
    const { orgId } = body || {};

    if (!orgId || typeof orgId !== "string") {
      return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    }

    // Verify user belongs to this org
    const membership = await getMembership(ctx.userId, orgId);
    if (!membership) {
      return NextResponse.json(
        { error: "You are not a member of this organization" },
        { status: 403 }
      );
    }

    const claims = {
      userId: ctx.userId,
      email: ctx.email,
      displayName: ctx.displayName,
      activeOrgId: orgId,
      role: membership.role,
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
        activeOrgId: orgId,
        role: membership.role,
        token,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to switch organization" }, { status: 500 });
  }
}
