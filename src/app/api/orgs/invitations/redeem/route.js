import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth/rbac";
import { redeemInvitation } from "@/lib/db/repos/invitationsRepo.js";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";

export async function POST(request) {
  try {
    const { error, ctx } = await requireAuth(request);
    if (error) return error;

    if (!ctx.userId) {
      return NextResponse.json({ error: "Only registered users can redeem invitations" }, { status: 400 });
    }

    const body = await request.json();
    const { code } = body || {};

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Invitation code is required" }, { status: 400 });
    }

    let redeemed;
    try {
      redeemed = await redeemInvitation(code.trim(), ctx.userId);
    } catch (err) {
      const status = err.code === "INVITATION_NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }

    // Set as active org
    const cookieStore = await cookies();
    await setDashboardAuthCookie(cookieStore, request, {
      userId: ctx.userId,
      email: ctx.email,
      displayName: ctx.displayName,
      activeOrgId: redeemed.orgId,
      role: redeemed.role,
    });

    return NextResponse.json({
      success: true,
      orgId: redeemed.orgId,
      role: redeemed.role,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to redeem invitation" }, { status: 500 });
  }
}
