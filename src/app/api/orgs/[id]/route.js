import { NextResponse } from "next/server";
import {
  requireOrgMember,
  requireOrgAdmin,
  requireSuperadmin,
} from "@/lib/auth/rbac";
import {
  getOrganizationById,
  updateOrganization,
  deleteOrganization,
} from "@/lib/db/repos/organizationsRepo.js";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const { error } = await requireOrgMember(request, id);
    if (error) return error;

    const org = await getOrganizationById(id);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({ organization: org });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to fetch organization" }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const { error, ctx } = await requireOrgAdmin(request, id);
    if (error) return error;

    const body = await request.json();
    const patch = {};

    if (body.name !== undefined) patch.name = body.name;
    if (body.plan_tier !== undefined) patch.plan_tier = body.plan_tier;
    if (body.pay_as_you_go_ceiling !== undefined) {
      patch.pay_as_you_go_ceiling = Number(body.pay_as_you_go_ceiling);
    }

    // Only superadmin can change organization status
    if (body.status !== undefined) {
      if (!ctx.isSuperadmin) {
        return NextResponse.json(
          { error: "Only platform superadmin can alter organization status" },
          { status: 403 }
        );
      }
      patch.status = body.status;
    }

    const updated = await updateOrganization(id, patch);
    if (!updated) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({ organization: updated });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to update organization" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    // DELETE is strictly superadmin-only
    const { error } = await requireSuperadmin(request);
    if (error) return error;

    const ok = await deleteOrganization(id);
    if (!ok) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to delete organization" }, { status: 500 });
  }
}
