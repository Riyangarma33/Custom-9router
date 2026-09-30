import { getAdapter } from "../driver.js";

function rowToMembership(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    orgId: row.org_id,
    role: row.role, // 'org_admin' | 'member'
    invitedBy: row.invited_by || null,
    joinedAt: row.joined_at,
    // Optional joined user/org info if queried with JOIN
    userEmail: row.email,
    userDisplayName: row.display_name,
    orgName: row.org_name,
    orgType: row.org_type || "standard",
  };
}

export async function getMembershipsForUser(userId) {
  if (!userId) return [];
  const db = await getAdapter();
  const rows = db.all(
    `SELECT m.*, o.name as org_name, o.type as org_type, o.status as org_status
     FROM org_memberships m
     JOIN organizations o ON m.org_id = o.id
     WHERE m.user_id = ?
     ORDER BY m.joined_at ASC`,
    [userId]
  );
  return rows.map(rowToMembership);
}

export async function getMembershipsForOrg(orgId) {
  if (!orgId) return [];
  const db = await getAdapter();
  const rows = db.all(
    `SELECT m.*, u.email, u.display_name
     FROM org_memberships m
     JOIN users u ON m.user_id = u.id
     WHERE m.org_id = ?
     ORDER BY m.joined_at ASC`,
    [orgId]
  );
  return rows.map(rowToMembership);
}

export async function getMembership(userId, orgId) {
  if (!userId || !orgId) return null;
  const db = await getAdapter();
  const row = db.get(
    `SELECT m.*, u.email, u.display_name, o.name as org_name
     FROM org_memberships m
     JOIN users u ON m.user_id = u.id
     JOIN organizations o ON m.org_id = o.id
     WHERE m.user_id = ? AND m.org_id = ?`,
    [userId, orgId]
  );
  return rowToMembership(row);
}

export async function addMembership({
  userId,
  orgId,
  role = "member",
  invitedBy = null,
}) {
  if (!userId || !orgId) {
    throw new Error("userId and orgId are required");
  }
  if (!["org_admin", "member"].includes(role)) {
    throw new Error("Invalid role. Must be 'org_admin' or 'member'");
  }

  const db = await getAdapter();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO org_memberships(user_id, org_id, role, invited_by, joined_at)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(user_id, org_id) DO UPDATE SET
       role = excluded.role,
       invited_by = excluded.invited_by`,
    [userId, orgId, role, invitedBy, now]
  );

  return {
    userId,
    orgId,
    role,
    invitedBy,
    joinedAt: now,
  };
}

export async function updateMembershipRole(userId, orgId, role) {
  if (!["org_admin", "member"].includes(role)) {
    throw new Error("Invalid role. Must be 'org_admin' or 'member'");
  }
  const db = await getAdapter();
  const res = db.run(
    `UPDATE org_memberships SET role = ? WHERE user_id = ? AND org_id = ?`,
    [role, userId, orgId]
  );
  return (res?.changes ?? 0) > 0;
}

export async function removeMembership(userId, orgId) {
  const db = await getAdapter();
  const res = db.run(
    `DELETE FROM org_memberships WHERE user_id = ? AND org_id = ?`,
    [userId, orgId]
  );
  return (res?.changes ?? 0) > 0;
}
