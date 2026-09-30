// Multi-tenancy migration: organizations, users, memberships, invitations,
// superadmins, orgSettings, and providerConnections/apiKeys scoping.
import bcrypt from "bcryptjs";
import { TABLES, buildCreateTableSql } from "../schema.js";

const DEFAULT_ORG_ID = "org_default";

function ensureColumn(db, table, colName, colDef) {
  const info = db.all(`PRAGMA table_info(${table})`);
  const exists = info.some((c) => c.name === colName);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
  }
}

export default {
  version: 2,
  name: "multi-tenancy-core",
  up(db) {
    // 1. Create new multi-tenancy tables if not present
    const mtTables = [
      "organizations",
      "users",
      "org_memberships",
      "org_invitations",
      "superadmins",
      "orgSettings",
    ];

    for (const name of mtTables) {
      if (TABLES[name]) {
        db.exec(buildCreateTableSql(name, TABLES[name]));
        for (const idx of TABLES[name].indexes || []) {
          try {
            db.exec(idx);
          } catch {}
        }
      }
    }

    ensureColumn(db, "organizations", "type", "TEXT DEFAULT 'standard'");

    // 2. Ensure additive columns on existing tables
    ensureColumn(db, "providerConnections", "owner_user_id", "TEXT");
    ensureColumn(db, "providerConnections", "org_id", "TEXT");
    ensureColumn(db, "providerConnections", "is_org_shared", "INTEGER DEFAULT 0");

    ensureColumn(db, "apiKeys", "user_id", "TEXT");
    ensureColumn(db, "apiKeys", "org_id", "TEXT");

    ensureColumn(db, "usageHistory", "userId", "TEXT");
    ensureColumn(db, "usageHistory", "orgId", "TEXT");

    // Recreate indexes on existing tables if defined
    for (const name of ["providerConnections", "apiKeys", "usageHistory"]) {
      for (const idx of TABLES[name]?.indexes || []) {
        try {
          db.exec(idx);
        } catch {}
      }
    }

    const now = new Date().toISOString();

    // 3. Seed default organization if empty
    const existingOrg = db.get(`SELECT id FROM organizations WHERE id = ?`, [DEFAULT_ORG_ID]);
    if (!existingOrg) {
      db.run(
        `INSERT OR IGNORE INTO organizations(id, name, plan_tier, pay_as_you_go_ceiling, status, created_by, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [DEFAULT_ORG_ID, "Default Organization", "free", 0.0, "active", "system", now, now]
      );
    }

    // 4. Backfill existing providerConnections: assign to default org as org-shared
    db.run(
      `UPDATE providerConnections
       SET org_id = ?, is_org_shared = 1
       WHERE org_id IS NULL OR org_id = ''`,
      [DEFAULT_ORG_ID]
    );

    // 5. Backfill existing apiKeys: assign to default org
    db.run(
      `UPDATE apiKeys
       SET org_id = ?
       WHERE org_id IS NULL OR org_id = ''`,
      [DEFAULT_ORG_ID]
    );

    // 6. Seed superadmin if superadmins table is empty
    const adminRow = db.get(`SELECT COUNT(*) as count FROM superadmins`);
    if (!adminRow || adminRow.count === 0) {
      const initialPassword = process.env.SUPERADMIN_PASSWORD || process.env.INITIAL_PASSWORD || "123456";
      const hash = bcrypt.hashSync(initialPassword, 10);
      db.run(
        `INSERT INTO superadmins(id, username, password_hash, created_at, last_login_at)
         VALUES(?, ?, ?, ?, ?)`,
        ["sa_superadmin", "admin", hash, now, null]
      );
    }
  },
};
