import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/auth/rbac";
import { revokeInvitation } from "@/lib/db/repos/invitationsRepo.js";

export async function DELETE(request, { params }) {
  try {
    const { id, code } = await params;
    const { error } = await requireOrgAdmin(request, id);
    if (error) return error;

    const ok = await revokeInvitation(code);
    if (!ok) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, revokedCode: code });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to revoke invitation" }, { status: 500 });
  }
}
