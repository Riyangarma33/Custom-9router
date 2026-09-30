import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/rbac";
import { setOrganizationStatus } from "@/lib/db/repos/organizationsRepo.js";

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const { error } = await requireSuperadmin(request);
    if (error) return error;

    const body = await request.json();
    const { status } = body || {};

    if (!["active", "suspended"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status. Must be 'active' or 'suspended'" },
        { status: 400 }
      );
    }

    const updated = await setOrganizationStatus(id, status);
    if (!updated) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({ organization: updated });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to update status" }, { status: 500 });
  }
}
