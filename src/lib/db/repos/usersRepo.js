import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { getAdapter } from "../driver.js";

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    password_hash: row.password_hash || null,
    display_name: row.display_name || null,
    authSource: row.authSource || "local",
    created_at: row.created_at,
    last_login_at: row.last_login_at || null,
  };
}

export async function getUserById(id) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM users WHERE id = ?`, [id]);
  return rowToUser(row);
}

export async function getUserByEmail(email) {
  if (!email || typeof email !== "string") return null;
  const db = await getAdapter();
  const normalized = email.trim().toLowerCase();
  const row = db.get(`SELECT * FROM users WHERE LOWER(email) = ?`, [normalized]);
  return rowToUser(row);
}

export async function createUser({
  email,
  password,
  displayName,
  authSource = "local",
}) {
  if (!email || typeof email !== "string") {
    throw new Error("Valid email is required");
  }
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await getUserByEmail(normalizedEmail);
  if (existing) {
    const err = new Error(`User with email "${normalizedEmail}" already exists`);
    err.code = "USER_EXISTS";
    throw err;
  }

  let password_hash = null;
  if (password) {
    if (typeof password !== "string" || password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }
    password_hash = await bcrypt.hash(password, 10);
  }

  const db = await getAdapter();
  const now = new Date().toISOString();
  const user = {
    id: uuidv4(),
    email: normalizedEmail,
    password_hash,
    display_name: displayName?.trim() || normalizedEmail.split("@")[0],
    authSource,
    created_at: now,
    last_login_at: null,
  };

  db.run(
    `INSERT INTO users(id, email, password_hash, display_name, authSource, created_at, last_login_at)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      user.email,
      user.password_hash,
      user.display_name,
      user.authSource,
      user.created_at,
      user.last_login_at,
    ]
  );

  return user;
}

export async function updateUser(id, patch = {}) {
  const db = await getAdapter();
  let result = null;

  db.transaction(() => {
    const existing = db.get(`SELECT * FROM users WHERE id = ?`, [id]);
    if (!existing) return;

    const user = rowToUser(existing);
    if (patch.password) {
      patch.password_hash = bcrypt.hashSync(patch.password, 10);
      delete patch.password;
    }

    const updated = {
      ...user,
      ...patch,
    };

    db.run(
      `UPDATE users
       SET email = ?, password_hash = ?, display_name = ?, authSource = ?, last_login_at = ?
       WHERE id = ?`,
      [
        updated.email,
        updated.password_hash,
        updated.display_name,
        updated.authSource,
        updated.last_login_at,
        id,
      ]
    );

    result = updated;
  });

  return result;
}

export async function recordUserLogin(id) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(`UPDATE users SET last_login_at = ? WHERE id = ?`, [now, id]);
}

export async function verifyUserPassword(email, password) {
  if (!email || !password) return null;
  const user = await getUserByEmail(email);
  if (!user || !user.password_hash) return null;

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

  return user;
}

export async function upsertSsoUser({ email, displayName, authSource = "oidc", sub = null }) {
  if (!email) throw new Error("Email is required for SSO user");
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await getUserByEmail(normalizedEmail);

  if (existing) {
    await recordUserLogin(existing.id);
    return existing;
  }

  const db = await getAdapter();
  const now = new Date().toISOString();
  let user;

  db.transaction(() => {
    user = {
      id: uuidv4(),
      email: normalizedEmail,
      password_hash: null,
      display_name: displayName || normalizedEmail.split("@")[0],
      authSource,
      created_at: now,
      last_login_at: now,
    };

    db.run(
      `INSERT INTO users(id, email, password_hash, display_name, authSource, created_at, last_login_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.email,
        user.password_hash,
        user.display_name,
        user.authSource,
        user.created_at,
        user.last_login_at,
      ]
    );

    // Bootstrapping: auto-provision personal workspace for new SSO user
    const personalOrgId = uuidv4();
    const workspaceName = `${user.email}'s Workspace`;
    db.run(
      `INSERT INTO organizations(id, name, type, plan_tier, pay_as_you_go_ceiling, status, created_by, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        personalOrgId,
        workspaceName,
        "personal_auto",
        "free",
        0.0,
        "active",
        user.id,
        now,
        now,
      ]
    );

    db.run(
      `INSERT INTO org_memberships(user_id, org_id, role, invited_by, joined_at)
       VALUES(?, ?, ?, ?, ?)`,
      [user.id, personalOrgId, "org_admin", "system", now]
    );
  });

  return user;
}

/**
 * Atomic user registration with signup bootstrapping:
 * - If invitation code present: joins invited org directly (role specified by invite).
 * - If no invitation code: auto-provisions personal workspace ('personal_auto') with 'org_admin' role.
 * Both executed in the same database transaction.
 */
export async function registerUserWithBootstrapping({
  email,
  password,
  displayName,
  invitationCode,
  authSource = "local",
}) {
  if (!email || typeof email !== "string") {
    throw new Error("Valid email is required");
  }
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await getUserByEmail(normalizedEmail);
  if (existing) {
    const err = new Error(`User with email "${normalizedEmail}" already exists`);
    err.code = "USER_EXISTS";
    throw err;
  }

  let password_hash = null;
  if (password) {
    if (typeof password !== "string" || password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }
    password_hash = await bcrypt.hash(password, 10);
  }

  const db = await getAdapter();
  const now = new Date().toISOString();
  let result;

  db.transaction(() => {
    const user = {
      id: uuidv4(),
      email: normalizedEmail,
      password_hash,
      display_name: displayName?.trim() || normalizedEmail.split("@")[0],
      authSource,
      created_at: now,
      last_login_at: null,
    };

    db.run(
      `INSERT INTO users(id, email, password_hash, display_name, authSource, created_at, last_login_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.email,
        user.password_hash,
        user.display_name,
        user.authSource,
        user.created_at,
        user.last_login_at,
      ]
    );

    if (invitationCode && typeof invitationCode === "string" && invitationCode.trim()) {
      // Invitation path: validate and redeem invitation
      const code = invitationCode.trim();
      const row = db.get(`SELECT * FROM org_invitations WHERE code = ?`, [code]);
      if (!row) {
        const err = new Error("Invalid invitation code");
        err.code = "INVITATION_NOT_FOUND";
        throw err;
      }
      if (row.used_by) {
        const err = new Error("Invitation code has already been used");
        err.code = "INVITATION_ALREADY_USED";
        throw err;
      }
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        const err = new Error("Invitation code has expired");
        err.code = "INVITATION_EXPIRED";
        throw err;
      }

      db.run(
        `UPDATE org_invitations SET used_by = ?, used_at = ? WHERE code = ?`,
        [user.id, now, code]
      );

      db.run(
        `INSERT INTO org_memberships(user_id, org_id, role, invited_by, joined_at)
         VALUES(?, ?, ?, ?, ?)`,
        [user.id, row.org_id, row.role_to_assign, row.created_by, now]
      );

      result = {
        user,
        activeOrgId: row.org_id,
        role: row.role_to_assign,
        joinedViaInvite: true,
      };
    } else {
      // Solo signup bootstrapping: quietly create a personal workspace in the same transaction
      const personalOrgId = uuidv4();
      const workspaceName = `${user.display_name || user.email.split("@")[0]}'s Workspace`;

      db.run(
        `INSERT INTO organizations(id, name, type, plan_tier, pay_as_you_go_ceiling, status, created_by, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          personalOrgId,
          workspaceName,
          "personal_auto",
          "free",
          0.0,
          "active",
          user.id,
          now,
          now,
        ]
      );

      db.run(
        `INSERT INTO org_memberships(user_id, org_id, role, invited_by, joined_at)
         VALUES(?, ?, ?, ?, ?)`,
        [user.id, personalOrgId, "org_admin", "system", now]
      );

      result = {
        user,
        activeOrgId: personalOrgId,
        role: "org_admin",
        joinedViaInvite: false,
      };
    }
  });

  return result;
}
