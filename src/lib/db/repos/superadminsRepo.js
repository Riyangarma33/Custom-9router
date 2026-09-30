import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { getAdapter } from "../driver.js";

function rowToSuperadmin(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    password_hash: row.password_hash,
    created_at: row.created_at,
    last_login_at: row.last_login_at || null,
  };
}

export async function getSuperadminByUsername(username = "admin") {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM superadmins WHERE username = ?`, [username]);
  return rowToSuperadmin(row);
}

export async function verifySuperadminPassword(username = "admin", password) {
  if (!password || typeof password !== "string") return false;
  const admin = await getSuperadminByUsername(username);
  if (!admin) {
    // If not seeded yet, check against process.env.INITIAL_PASSWORD or DEFAULT_PASSWORD
    const initial = process.env.SUPERADMIN_PASSWORD || process.env.INITIAL_PASSWORD || "123456";
    if (password === initial) {
      await seedSuperadmin(initial);
      return true;
    }
    return false;
  }

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (valid) {
    const db = await getAdapter();
    const now = new Date().toISOString();
    db.run(`UPDATE superadmins SET last_login_at = ? WHERE id = ?`, [now, admin.id]);
  }
  return valid;
}

export async function updateSuperadminPassword(username = "admin", newPassword) {
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  const db = await getAdapter();
  const hash = await bcrypt.hash(newPassword, 10);
  const now = new Date().toISOString();

  const existing = await getSuperadminByUsername(username);
  if (existing) {
    db.run(
      `UPDATE superadmins SET password_hash = ?, last_login_at = ? WHERE username = ?`,
      [hash, now, username]
    );
  } else {
    db.run(
      `INSERT INTO superadmins(id, username, password_hash, created_at, last_login_at)
       VALUES(?, ?, ?, ?, ?)`,
      [uuidv4(), username, hash, now, now]
    );
  }
  return true;
}

export async function seedSuperadmin(initialPassword = "123456") {
  const db = await getAdapter();
  const existing = await getSuperadminByUsername("admin");
  if (existing) return existing;

  const hash = await bcrypt.hash(initialPassword, 10);
  const now = new Date().toISOString();
  const id = uuidv4();

  db.run(
    `INSERT OR IGNORE INTO superadmins(id, username, password_hash, created_at, last_login_at)
     VALUES(?, ?, ?, ?, ?)`,
    [id, "admin", hash, now, null]
  );

  return { id, username: "admin", password_hash: hash, created_at: now, last_login_at: null };
}
