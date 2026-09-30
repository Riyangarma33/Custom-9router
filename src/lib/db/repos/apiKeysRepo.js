import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    user_id: row.user_id || null,
    org_id: row.org_id || null,
    org_name: row.org_name || (row.org_id === "org_default" ? "Default Organization" : (row.org_id || "Unassigned")),
    org_type: row.org_type || "standard",
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
}

export async function getApiKeys(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];

  // Scoped caller filtering
  if (filter.accessibleBy) {
    const { orgId, isSuperadmin } = filter.accessibleBy;
    if (!isSuperadmin) {
      where.push("k.org_id = ?");
      params.push(orgId || "org_default");
    } else if (filter.org_id) {
      where.push("k.org_id = ?");
      params.push(filter.org_id);
    }
  } else if (filter.org_id) {
    where.push("k.org_id = ?");
    params.push(filter.org_id);
  }

  if (filter.user_id) {
    where.push("k.user_id = ?");
    params.push(filter.user_id);
  }

  const sql = `
    SELECT k.*, o.name as org_name, o.type as org_type
    FROM apiKeys k
    LEFT JOIN organizations o ON k.org_id = o.id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY k.createdAt ASC
  `;
  const rows = db.all(sql, params);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(
    `SELECT k.*, o.name as org_name, o.type as org_type
     FROM apiKeys k
     LEFT JOIN organizations o ON k.org_id = o.id
     WHERE k.id = ?`,
    [id]
  );
  return rowToKey(row);
}

export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(
    `SELECT k.*, o.name as org_name, o.type as org_type
     FROM apiKeys k
     LEFT JOIN organizations o ON k.org_id = o.id
     WHERE k.key = ?`,
    [key]
  );
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const orgId = options.orgId || options.org_id || "org_default";

  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    user_id: options.userId || options.user_id || null,
    org_id: orgId,
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, user_id, org_id, isActive, createdAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      apiKey.user_id,
      apiKey.org_id,
      1,
      apiKey.createdAt,
    ]
  );

  return getApiKeyById(apiKey.id);
}

export async function updateApiKey(id, data, context = null) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const existing = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!existing) return;

    if (context && !context.isSuperadmin) {
      if (existing.org_id && context.orgId && existing.org_id !== context.orgId) {
        const err = new Error("API key belongs to another organization");
        err.code = "FORBIDDEN";
        throw err;
      }
      if (context.role !== "org_admin" && !context.isLocal) {
        const err = new Error("Only org_admin can update API keys");
        err.code = "FORBIDDEN";
        throw err;
      }
    }

    const merged = { ...rowToKey(existing), ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, user_id = ?, org_id = ?, isActive = ? WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.user_id,
        merged.org_id,
        merged.isActive ? 1 : 0,
        id,
      ]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id, context = null) {
  const db = await getAdapter();
  let ok = false;
  db.transaction(() => {
    const existing = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!existing) return;

    if (context && !context.isSuperadmin) {
      if (existing.org_id && context.orgId && existing.org_id !== context.orgId) {
        const err = new Error("API key belongs to another organization");
        err.code = "FORBIDDEN";
        throw err;
      }
      if (context.role !== "org_admin" && !context.isLocal) {
        const err = new Error("Only org_admin can delete API keys");
        err.code = "FORBIDDEN";
        throw err;
      }
    }

    const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
    ok = (res?.changes ?? 0) > 0;
  });
  return ok;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
