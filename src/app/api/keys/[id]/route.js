import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { resolveCallerContext } from "@/lib/auth/rbac";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const ctx = await resolveCallerContext(request);
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    if (!ctx.isSuperadmin && key.org_id && ctx.orgId && key.org_id !== ctx.orgId) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const ctx = await resolveCallerContext(request);
    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    if (!ctx.isSuperadmin && existing.org_id && ctx.orgId && existing.org_id !== ctx.orgId) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    if (!ctx.isSuperadmin && ctx.role !== "org_admin" && !ctx.isLocal) {
      return NextResponse.json({ error: "Forbidden: Only org_admin can update keys" }, { status: 403 });
    }

    const body = await request.json();
    const { isActive, name } = body;

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (name !== undefined) updateData.name = name;

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const ctx = await resolveCallerContext(request);
    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    if (!ctx.isSuperadmin && existing.org_id && ctx.orgId && existing.org_id !== ctx.orgId) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    if (!ctx.isSuperadmin && ctx.role !== "org_admin" && !ctx.isLocal) {
      return NextResponse.json({ error: "Forbidden: Only org_admin can delete keys" }, { status: 403 });
    }

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
