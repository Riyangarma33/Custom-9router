import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/auth/rbac";
import {
  getInvitationsForOrg,
  createInvitation,
} from "@/lib/db/repos/invitationsRepo.js";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const { error } = await requireOrgAdmin(request, id);
    if (error) return error;

    const invitations = await getInvitationsForOrg(id);
    return NextResponse.json({ invitations });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to fetch invitations" }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { error, ctx } = await requireOrgAdmin(request, id);
    if (error) return error;

    const body = await request.json();
    const { role_to_assign = "member", expiresInHours = 48 } = body || {};

    if (!["org_admin", "member"].includes(role_to_assign)) {
      return NextResponse.json(
        { error: "role_to_assign must be 'org_admin' or 'member'" },
        { status: 400 }
      );
    }

    const invitation = await createInvitation({
      orgId: id,
      roleToAssign: role_to_assign,
      createdBy: ctx.userId || ctx.username || "admin",
      expiresInHours: Number(expiresInHours) || 48,
    });

    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to create invitation" }, { status: 500 });
  }
}
