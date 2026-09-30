import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { resolveCallerContext } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys scoped to caller's org
export async function GET(request) {
  try {
    const ctx = await resolveCallerContext(request);
    let filter = {};
    if (ctx.isSuperadmin) {
      if (request?.url) {
        const url = new URL(request.url);
        const orgIdParam = url.searchParams.get("orgId");
        if (orgIdParam) filter.org_id = orgIdParam;
      }
    } else if (ctx.orgId) {
      filter.org_id = ctx.orgId;
    } else {
      filter.org_id = "org_default";
    }

    const keys = await getApiKeys(filter);
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key for the active organization
export async function POST(request) {
  try {
    const ctx = await resolveCallerContext(request);
    if (!ctx.authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Gate API key creation to org_admin or superadmin
    if (!ctx.isSuperadmin && ctx.role !== "org_admin" && !ctx.isLocal) {
      return NextResponse.json(
        { error: "Forbidden: Only org_admin can manage organization API keys" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, {
      userId: ctx.userId,
      orgId: ctx.orgId || "org_default",
    });

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      orgId: apiKey.org_id,
      userId: apiKey.user_id,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
