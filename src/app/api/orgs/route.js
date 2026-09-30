import { NextResponse } from "next/server";
import { resolveCallerContext, requireSuperadmin } from "@/lib/auth/rbac";
import {
  getOrganizations,
  getOrganizationsForUser,
  createOrganization,
} from "@/lib/db/repos/organizationsRepo.js";

export async function GET(request) {
  try {
    const ctx = await resolveCallerContext(request);
    if (!ctx.authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (ctx.isSuperadmin) {
      const orgs = await getOrganizations();
      return NextResponse.json({ organizations: orgs });
    }

    if (ctx.userId) {
      const orgs = await getOrganizationsForUser(ctx.userId);
      return NextResponse.json({ organizations: orgs });
    }

    // Local default org
    const orgs = await getOrganizations();
    return NextResponse.json({ organizations: orgs });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to fetch organizations" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { error, ctx } = await requireSuperadmin(request);
    if (error) return error;

    const body = await request.json();
    const { name, plan_tier, pay_as_you_go_ceiling } = body || {};

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Organization name is required" }, { status: 400 });
    }

    const org = await createOrganization({
      name,
      plan_tier: plan_tier || "free",
      pay_as_you_go_ceiling: pay_as_you_go_ceiling || 0,
      created_by: ctx.username || "superadmin",
    });

    return NextResponse.json({ organization: org }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to create organization" }, { status: 500 });
  }
}
