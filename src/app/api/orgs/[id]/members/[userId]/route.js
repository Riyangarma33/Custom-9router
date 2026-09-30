import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/auth/rbac";
import {
  updateMembershipRole,
  removeMembership,
} from "@/lib/db/repos/membershipsRepo.js";

export async function PATCH(request, { params }) {
  try {
    const { id, userId } = await params;
    const { error } = await requireOrgAdmin(request, id);
    if (error) return error;

    const body = await request.json();
    const { role } = body || {};

    if (!["org_admin", "member"].includes(role)) {
      return NextResponse.json({ error: "Role must be 'org_admin' or 'member'" }, { status: 400 });
    }

    const ok = await updateMembershipRole(userId, id, role);
    if (!ok) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, userId, orgId: id, role });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to update member role" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id, userId } = await params;
    const { error } = await requireOrgAdmin(request, id);
    if (error) return error;

    const ok = await removeMembership(userId, id);
    if (!ok) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, removedUserId: userId, orgId: id });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to remove member" }, { status: 500 });
  }
}
