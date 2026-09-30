import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToOrg(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    plan_tier: row.plan_tier || "free",
    pay_as_you_go_ceiling: Number(row.pay_as_you_go_ceiling || 0),
    status: row.status || "active",
    created_by: row.created_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getOrganizations() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM organizations ORDER BY created_at ASC`);
  return rows.map(rowToOrg);
}

export async function getOrganizationsForUser(userId) {
  if (!userId) return [];
  const db = await getAdapter();
  const rows = db.all(
    `SELECT o.*, m.role, m.joined_at
     FROM organizations o
     JOIN org_memberships m ON o.id = m.org_id
     WHERE m.user_id = ?
     ORDER BY o.created_at ASC`,
    [userId]
  );
  return rows.map((r) => ({
    ...rowToOrg(r),
    role: r.role,
    joined_at: r.joined_at,
  }));
}

export async function getOrganizationById(id) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM organizations WHERE id = ?`, [id]);
  return rowToOrg(row);
}

export async function createOrganization({
  id = uuidv4(),
  name,
  plan_tier = "free",
  pay_as_you_go_ceiling = 0.0,
  created_by = "superadmin",
}) {
  if (!name || typeof name !== "string") {
    throw new Error("Organization name is required");
  }
  const db = await getAdapter();
  const now = new Date().toISOString();
  const org = {
    id,
    name: name.trim(),
    plan_tier,
    pay_as_you_go_ceiling: Number(pay_as_you_go_ceiling) || 0,
    status: "active",
    created_by,
    created_at: now,
    updated_at: now,
  };

  db.run(
    `INSERT INTO organizations(id, name, plan_tier, pay_as_you_go_ceiling, status, created_by, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      org.id,
      org.name,
      org.plan_tier,
      org.pay_as_you_go_ceiling,
      org.status,
      org.created_by,
      org.created_at,
      org.updated_at,
    ]
  );

  return org;
}

export async function updateOrganization(id, patch = {}) {
  const db = await getAdapter();
  let result = null;

  db.transaction(() => {
    const existing = db.get(`SELECT * FROM organizations WHERE id = ?`, [id]);
    if (!existing) return;

    const updated = {
      ...rowToOrg(existing),
      ...patch,
      updated_at: new Date().toISOString(),
    };

    db.run(
      `UPDATE organizations
       SET name = ?, plan_tier = ?, pay_as_you_go_ceiling = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      [
        updated.name,
        updated.plan_tier,
        Number(updated.pay_as_you_go_ceiling) || 0,
        updated.status,
        updated.updated_at,
        id,
      ]
    );

    result = updated;
  });

  return result;
}

export async function setOrganizationStatus(id, status) {
  if (!["active", "suspended"].includes(status)) {
    throw new Error("Invalid organization status. Must be 'active' or 'suspended'");
  }
  return updateOrganization(id, { status });
}

export async function deleteOrganization(id) {
  const db = await getAdapter();
  let ok = false;

  db.transaction(() => {
    // Delete memberships
    db.run(`DELETE FROM org_memberships WHERE org_id = ?`, [id]);
    // Delete invitations
    db.run(`DELETE FROM org_invitations WHERE org_id = ?`, [id]);
    // Delete orgSettings
    db.run(`DELETE FROM orgSettings WHERE org_id = ?`, [id]);
    // Delete provider connections belonging to this org
    db.run(`DELETE FROM providerConnections WHERE org_id = ?`, [id]);
    // Delete API keys belonging to this org
    db.run(`DELETE FROM apiKeys WHERE org_id = ?`, [id]);
    // Delete organization itself
    const res = db.run(`DELETE FROM organizations WHERE id = ?`, [id]);
    ok = (res?.changes ?? 0) > 0;
  });

  return ok;
}
