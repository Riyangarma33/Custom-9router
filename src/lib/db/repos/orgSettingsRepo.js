import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getSettings } from "./settingsRepo.js";

export async function getOrgSettings(orgId) {
  if (!orgId) return getSettings();
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM orgSettings WHERE org_id = ?`, [orgId]);
  const global = await getSettings();
  if (!row) return { ...global, orgId };

  const orgCustom = parseJson(row.data, {});
  return {
    ...global,
    ...orgCustom,
    orgId,
  };
}

export async function updateOrgSettings(orgId, updates) {
  if (!orgId) throw new Error("orgId is required");
  const db = await getAdapter();
  let next;

  db.transaction(() => {
    const row = db.get(`SELECT data FROM orgSettings WHERE org_id = ?`, [orgId]);
    const current = row ? parseJson(row.data, {}) : {};
    next = { ...current, ...updates };
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO orgSettings(org_id, data, updated_at) VALUES(?, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [orgId, stringifyJson(next), now]
    );
  });

  return getOrgSettings(orgId);
}

export async function deleteOrgSettings(orgId) {
  if (!orgId) return false;
  const db = await getAdapter();
  const res = db.run(`DELETE FROM orgSettings WHERE org_id = ?`, [orgId]);
  return (res?.changes ?? 0) > 0;
}
