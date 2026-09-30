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
  const user = {
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

  return user;
}
