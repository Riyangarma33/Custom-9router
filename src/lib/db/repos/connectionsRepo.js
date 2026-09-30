import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const OPTIONAL_FIELDS = [
  "displayName", "email", "globalPriority", "defaultModel",
  "accessToken", "refreshToken", "expiresAt", "tokenType",
  "scope", "projectId", "apiKey", "testStatus",
  "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn", "errorCode",
  "consecutiveUseCount", "idToken", "lastRefreshAt",
  "owner_user_id", "org_id", "is_org_shared",
];

const MODEL_LOCK_PREFIX = "modelLock_";

function resetHealthStateOnActivation(existing, patch) {
  if (patch?.testStatus !== "active") return patch;

  const normalized = {
    ...patch,
    testStatus: "active",
    lastError: Object.hasOwn(patch, "lastError") ? patch.lastError : null,
    lastErrorAt: Object.hasOwn(patch, "lastErrorAt") ? patch.lastErrorAt : null,
    errorCode: null,
    rateLimitedUntil: null,
    backoffLevel: 0,
  };

  for (const key of Object.keys(existing || {})) {
    if (key.startsWith(MODEL_LOCK_PREFIX)) normalized[key] = null;
  }

  return normalized;
}

function rowToConn(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    provider: row.provider,
    authType: row.authType,
    name: row.name,
    email: row.email,
    priority: row.priority,
    isActive: row.isActive === 1 || row.isActive === true,
    owner_user_id: row.owner_user_id || null,
    org_id: row.org_id || null,
    is_org_shared: row.is_org_shared === 1 || row.is_org_shared === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function connToRow(c) {
  const {
    id, provider, authType, name, email, priority, isActive,
    owner_user_id, org_id, is_org_shared,
    createdAt, updatedAt, ...rest
  } = c;
  return {
    id,
    provider,
    authType,
    name: name ?? null,
    email: email ?? null,
    priority: priority ?? null,
    isActive: isActive === false ? 0 : 1,
    owner_user_id: owner_user_id ?? null,
    org_id: org_id ?? null,
    is_org_shared: is_org_shared ? 1 : 0,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, c) {
  const r = connToRow(c);
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, owner_user_id, org_id, is_org_shared, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider=excluded.provider, authType=excluded.authType, name=excluded.name,
       email=excluded.email, priority=excluded.priority, isActive=excluded.isActive,
       owner_user_id=excluded.owner_user_id, org_id=excluded.org_id, is_org_shared=excluded.is_org_shared,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [
      r.id, r.provider, r.authType, r.name, r.email, r.priority, r.isActive,
      r.owner_user_id, r.org_id, r.is_org_shared, r.data, r.createdAt, r.updatedAt,
    ]
  );
}

function deriveConnectionName(data, fallbackName) {
  if (data.provider === "github") {
    return data.providerSpecificData?.githubLogin
      || data.providerSpecificData?.githubEmail
      || data.email
      || data.providerSpecificData?.githubName
      || fallbackName;
  }
  return fallbackName;
}

export async function getProviderConnections(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.provider) { where.push("provider = ?"); params.push(filter.provider); }
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.org_id) { where.push("org_id = ?"); params.push(filter.org_id); }
  if (filter.owner_user_id) { where.push("owner_user_id = ?"); params.push(filter.owner_user_id); }
  if (filter.is_org_shared !== undefined) { where.push("is_org_shared = ?"); params.push(filter.is_org_shared ? 1 : 0); }

  // Context-aware caller filtering:
  // accessibleBy: { userId, orgId, isSuperadmin }
  if (filter.accessibleBy) {
    const { userId, orgId, isSuperadmin } = filter.accessibleBy;
    if (!isSuperadmin && orgId) {
      if (userId) {
        where.push("(org_id = ? AND (owner_user_id = ? OR is_org_shared = 1))");
        params.push(orgId, userId);
      } else {
        where.push("(org_id = ? AND is_org_shared = 1)");
        params.push(orgId);
      }
    }
  }

  const sql = `SELECT * FROM providerConnections${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const rows = db.all(sql, params);
  const list = rows.map(rowToConn);
  list.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  return list;
}

export async function getProviderConnectionById(id, context = null) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
  const conn = rowToConn(row);
  if (!conn) return null;

  if (context && !context.isSuperadmin) {
    if (context.orgId && conn.org_id && conn.org_id !== context.orgId) {
      return null;
    }
    if (!conn.is_org_shared && context.userId && conn.owner_user_id && conn.owner_user_id !== context.userId) {
      return null;
    }
  }

  return conn;
}

// Internal sync reorder — must be called INSIDE a transaction.
//
// Normalizes priorities to a contiguous 1..N after a DELETE or an explicit
// reorder, so gaps don't accumulate over time.
//
// Deliberately NOT called on insert: a new connection already gets
// MAX(priority)+1, which sorts after every existing row, so the order is
// identical with or without the rewrite. Skipping it there is what makes
// import O(1) per key instead of O(pool) — see createProviderConnection.
function reorderInTx(db, providerId) {
  const list = db.all(`SELECT * FROM providerConnections WHERE provider = ?`, [providerId]).map(rowToConn);
  list.sort((a, b) => {
    const pDiff = (a.priority || 0) - (b.priority || 0);
    if (pDiff !== 0) return pDiff;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  list.forEach((c, i) => {
    const want = i + 1;
    if ((c.priority || 0) !== want) {
      db.run(`UPDATE providerConnections SET priority = ? WHERE id = ?`, [want, c.id]);
    }
  });
}

export async function createProviderConnection(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const orgId = data.org_id || "org_default";
  const ownerUserId = data.owner_user_id || null;
  const isOrgShared = data.is_org_shared ? 1 : 0;
  let result;

  db.transaction(() => {
    // apikey connections are deduped by name and need only the current max
    // priority, so query for those directly instead of loading the whole pool
    // (O(pool) per key — the other half of the import cost in #4311). The oauth
    // branch below still scans, because its identity rules compare fields
    // inside providerSpecificData and have no single-column equivalent.
    // Scoped by org_id so tenants never collide or conflict.
    const isApikey = data.authType === "apikey" && !!data.name;
    const all = isApikey
      ? db.all(
          `SELECT * FROM providerConnections WHERE provider = ? AND authType = ? AND name = ? AND org_id = ?`,
          [data.provider, "apikey", data.name, orgId]
        ).map(rowToConn)
      : db.all(
          `SELECT * FROM providerConnections WHERE provider = ? AND org_id = ?`,
          [data.provider, orgId]
        ).map(rowToConn);
    const poolSize = isApikey
      ? db.get(`SELECT COUNT(*) AS n FROM providerConnections WHERE provider = ? AND org_id = ?`, [data.provider, orgId])?.n ?? all.length
      : all.length;

    let existing = null;
    if (data.authType === "oauth" && data.email) {
      const incomingUsername = data.providerSpecificData?.username;
      const incomingWs = data.providerSpecificData?.chatgptAccountId;
      existing = all.find(c => {
        if (c.authType !== "oauth" || c.email !== data.email) return false;

        // Codex/OpenAI can issue multiple OAuth grants for the same email.
        // Refresh tokens are rotated single-use; collapsing a new login onto an
        // existing bare-email row overwrites the first account's token pair and
        // makes it look "invalid" after adding a second account. Only update an
        // existing Codex row when both rows expose the same ChatGPT account ID.
        if (data.provider === "codex") {
          const existingWs = c.providerSpecificData?.chatgptAccountId;
          return !!incomingWs && !!existingWs && incomingWs === existingWs;
        }

        // Workspace providers use workspace ID when both sides have it
        const existingWs = c.providerSpecificData?.chatgptAccountId;
        if (incomingWs && existingWs) return incomingWs === existingWs;
        if (incomingWs && !existingWs) return false;
        if (!incomingWs && existingWs) return false;
        // Non-workspace providers: match on (email + username) so cross-IdP
        // accounts don't overwrite each other. Require username on both sides
        // — if only one side has it, treat as a distinct identity rather than
        // collapsing onto the bare-email fallback (which would re-introduce
        // the cross-IdP overwrite).
        const existingUsername = c.providerSpecificData?.username;
        if (incomingUsername && existingUsername) {
          return incomingUsername === existingUsername;
        }
        if (incomingUsername || existingUsername) return false;
        return true;
      });
    } else if (data.authType === "apikey" && data.name) {
      existing = all.find(c => c.authType === "apikey" && c.name === data.name);
    }
    // access_token: never dedup — user manages duplicates manually

    if (existing) {
      // Name collision on an apikey connection used to silently replace the
      // stored apiKey, so a script that reused names ("Key 1", "Key 2", …)
      // destroyed existing pool entries with no 409 and no warning. Callers that
      // genuinely mean "update this one" pass allowOverwrite; everyone else gets
      // a typed error naming the row that would have been replaced. #4311
      if (data.allowOverwrite === false) {
        const err = new Error(
          `A connection named "${existing.name}" already exists for provider "${data.provider}". ` +
          `Pass allowOverwrite: true to replace it.`
        );
        err.code = "PROVIDER_NAME_CONFLICT";
        err.existingId = existing.id;
        err.existingName = existing.name;
        throw err;
      }
      const normalized = resetHealthStateOnActivation(existing, data);
      const merged = {
        ...existing,
        ...normalized,
        owner_user_id: ownerUserId ?? existing.owner_user_id,
        org_id: orgId ?? existing.org_id,
        is_org_shared: data.is_org_shared !== undefined ? isOrgShared : existing.is_org_shared,
        updatedAt: now,
      };
      upsert(db, merged);
      result = merged;
      return;
    }

    let connectionName = data.name || null;
    if (!connectionName && (data.authType === "oauth" || data.authType === "access_token")) {
      connectionName = deriveConnectionName(data, data.email || `Account ${poolSize + 1}`);
    }
    let connectionPriority = data.priority;
    if (!connectionPriority) {
      // MAX(priority)+1 in SQL scoped to org_id
      const maxRow = db.get(
        `SELECT MAX(priority) AS m FROM providerConnections WHERE provider = ? AND org_id = ?`,
        [data.provider, orgId]
      );
      connectionPriority = (maxRow?.m || 0) + 1;
    }

    const conn = {
      id: uuidv4(),
      provider: data.provider,
      authType: data.authType || "oauth",
      name: connectionName,
      priority: connectionPriority,
      isActive: data.isActive !== undefined ? data.isActive : true,
      owner_user_id: ownerUserId,
      org_id: orgId,
      is_org_shared: isOrgShared,
      createdAt: now,
      updatedAt: now,
    };
    for (const f of OPTIONAL_FIELDS) {
      if (data[f] !== undefined && data[f] !== null) conn[f] = data[f];
    }
    if (data.providerSpecificData && Object.keys(data.providerSpecificData).length > 0) {
      conn.providerSpecificData = data.providerSpecificData;
    }
    if (data.email !== undefined) conn.email = data.email;

    upsert(db, conn);
    result = conn;
  });

  return result;
}

// Critical: OAuth refresh token race — atomic merge inside transaction
export async function updateProviderConnection(id, data, context = null) {
  const db = await getAdapter();
  let result;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
    if (!row) { result = null; return; }
    const existing = rowToConn(row);

    if (context && !context.isSuperadmin) {
      if (context.orgId && existing.org_id && existing.org_id !== context.orgId) {
        const err = new Error("Connection not found or belongs to another organization");
        err.code = "FORBIDDEN";
        throw err;
      }
      if (existing.is_org_shared) {
        if (context.role !== "org_admin") {
          const err = new Error("Only org_admin can modify shared connections");
          err.code = "FORBIDDEN";
          throw err;
        }
      } else if (existing.owner_user_id && context.userId && existing.owner_user_id !== context.userId) {
        const err = new Error("You do not own this connection");
        err.code = "FORBIDDEN";
        throw err;
      }
    }

    const normalized = resetHealthStateOnActivation(existing, data);
    const merged = { ...existing, ...normalized, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    if (data.priority !== undefined) reorderInTx(db, existing.provider);
    result = merged;
  });
  return result;
}

export async function deleteProviderConnection(id, context = null) {
  const db = await getAdapter();
  let ok = false;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
    if (!row) return;
    const existing = rowToConn(row);

    if (context && !context.isSuperadmin) {
      if (context.orgId && existing.org_id && existing.org_id !== context.orgId) {
        const err = new Error("Connection belongs to another organization");
        err.code = "FORBIDDEN";
        throw err;
      }
      if (existing.is_org_shared) {
        if (context.role !== "org_admin") {
          const err = new Error("Only org_admin can delete shared connections");
          err.code = "FORBIDDEN";
          throw err;
        }
      } else if (existing.owner_user_id && context.userId && existing.owner_user_id !== context.userId) {
        const err = new Error("You do not own this connection");
        err.code = "FORBIDDEN";
        throw err;
      }
    }

    db.run(`DELETE FROM providerConnections WHERE id = ?`, [id]);
    reorderInTx(db, existing.provider);
    ok = true;
  });
  return ok;
}

export async function deleteProviderConnectionsByProvider(providerId) {
  const db = await getAdapter();
  const before = db.get(`SELECT COUNT(*) AS n FROM providerConnections WHERE provider = ?`, [providerId]);
  db.run(`DELETE FROM providerConnections WHERE provider = ?`, [providerId]);
  return before?.n || 0;
}

export async function reorderProviderConnections(providerId) {
  const db = await getAdapter();
  db.transaction(() => reorderInTx(db, providerId));
}

export async function cleanupProviderConnections() {
  const db = await getAdapter();
  const fieldsToCheck = [
    "displayName", "email", "globalPriority", "defaultModel",
    "accessToken", "refreshToken", "expiresAt", "tokenType",
    "scope", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn",
    "consecutiveUseCount",
  ];
  let cleaned = 0;
  db.transaction(() => {
    const rows = db.all(`SELECT * FROM providerConnections`);
    for (const row of rows) {
      const conn = rowToConn(row);
      let dirty = false;
      for (const f of fieldsToCheck) {
        if (conn[f] === null || conn[f] === undefined) {
          if (f in conn) { delete conn[f]; cleaned++; dirty = true; }
        }
      }
      if (conn.providerSpecificData && Object.keys(conn.providerSpecificData).length === 0) {
        delete conn.providerSpecificData;
        cleaned++;
        dirty = true;
      }
      if (dirty) upsert(db, conn);
    }
  });
  return cleaned;
}
