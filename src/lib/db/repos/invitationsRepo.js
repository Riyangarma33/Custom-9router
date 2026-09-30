import crypto from "node:crypto";
import { getAdapter } from "../driver.js";
import { addMembership } from "./membershipsRepo.js";

function rowToInvitation(row) {
  if (!row) return null;
  return {
    code: row.code,
    orgId: row.org_id,
    roleToAssign: row.role_to_assign,
    createdBy: row.created_by,
    expiresAt: row.expires_at,
    usedBy: row.used_by || null,
    usedAt: row.used_at || null,
    isUsed: !!row.used_by,
    isExpired: new Date(row.expires_at).getTime() <= Date.now(),
  };
}

export async function createInvitation({
  orgId,
  roleToAssign = "member",
  createdBy,
  expiresInHours = 48,
}) {
  if (!orgId) throw new Error("orgId is required");
  if (!["org_admin", "member"].includes(roleToAssign)) {
    throw new Error("Invalid roleToAssign. Must be 'org_admin' or 'member'");
  }

  const db = await getAdapter();
  const code = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  db.run(
    `INSERT INTO org_invitations(code, org_id, role_to_assign, created_by, expires_at, used_by, used_at)
     VALUES(?, ?, ?, ?, ?, NULL, NULL)`,
    [code, orgId, roleToAssign, createdBy || "admin", expiresAt]
  );

  return {
    code,
    orgId,
    roleToAssign,
    createdBy,
    expiresAt,
    usedBy: null,
    usedAt: null,
  };
}

export async function getInvitationByCode(code) {
  if (!code) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM org_invitations WHERE code = ?`, [code.trim()]);
  return rowToInvitation(row);
}

export async function getInvitationsForOrg(orgId) {
  if (!orgId) return [];
  const db = await getAdapter();
  const rows = db.all(
    `SELECT * FROM org_invitations WHERE org_id = ? ORDER BY expires_at DESC`,
    [orgId]
  );
  return rows.map(rowToInvitation);
}

export async function redeemInvitation(code, userId) {
  if (!code || !userId) {
    throw new Error("Invitation code and userId are required");
  }

  const db = await getAdapter();
  let result = null;

  db.transaction(() => {
    const row = db.get(`SELECT * FROM org_invitations WHERE code = ?`, [code.trim()]);
    if (!row) {
      const err = new Error("Invalid invitation code");
      err.code = "INVITATION_NOT_FOUND";
      throw err;
    }

    const invitation = rowToInvitation(row);
    if (invitation.isUsed) {
      const err = new Error("Invitation code has already been used");
      err.code = "INVITATION_ALREADY_USED";
      throw err;
    }

    if (invitation.isExpired) {
      const err = new Error("Invitation code has expired");
      err.code = "INVITATION_EXPIRED";
      throw err;
    }

    const now = new Date().toISOString();

    // Mark invitation as used
    db.run(
      `UPDATE org_invitations SET used_by = ?, used_at = ? WHERE code = ?`,
      [userId, now, code.trim()]
    );

    // Create org membership
    db.run(
      `INSERT INTO org_memberships(user_id, org_id, role, invited_by, joined_at)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(user_id, org_id) DO UPDATE SET
         role = excluded.role,
         invited_by = excluded.invited_by`,
      [userId, invitation.orgId, invitation.roleToAssign, invitation.createdBy, now]
    );

    result = {
      orgId: invitation.orgId,
      role: invitation.roleToAssign,
      code: invitation.code,
      joinedAt: now,
    };
  });

  return result;
}

export async function revokeInvitation(code) {
  if (!code) return false;
  const db = await getAdapter();
  const res = db.run(`DELETE FROM org_invitations WHERE code = ?`, [code.trim()]);
  return (res?.changes ?? 0) > 0;
}
