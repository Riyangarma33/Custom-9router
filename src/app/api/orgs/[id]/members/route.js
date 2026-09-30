import { NextResponse } from "next/server";
import { requireOrgMember, requireOrgAdmin } from "@/lib/auth/rbac";
import {
  getMembershipsForOrg,
  addMembership,
} from "@/lib/db/repos/membershipsRepo.js";
import { getUserByEmail } from "@/lib/db/repos/usersRepo.js";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const { error } = await requireOrgMember(request, id);
    if (error) return error;

    const members = await getMembershipsForOrg(id);
    return NextResponse.json({ members });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to fetch members" }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { error, ctx } = await requireOrgAdmin(request, id);
    if (error) return error;

    const body = await request.json();
    const { email, userId, role = "member" } = body || {};

    let targetUserId = userId;
    if (!targetUserId && email) {
      const user = await getUserByEmail(email);
      if (!user) {
        return NextResponse.json({ error: "User not found with this email" }, { status: 404 });
      }
      targetUserId = user.id;
    }

    if (!targetUserId) {
      return NextResponse.json({ error: "Email or userId is required" }, { status: 400 });
    }

    const membership = await addMembership({
      userId: targetUserId,
      orgId: id,
      role: role === "org_admin" ? "org_admin" : "member",
      invitedBy: ctx.userId || ctx.username || "admin",
    });

    return NextResponse.json({ membership }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to add member" }, { status: 500 });
  }
}
