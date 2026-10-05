"use strict";

const crypto = require("node:crypto");
const LIMITS = Object.freeze({ lists: 20, companiesPerList: 250, companiesPerAccount: 1000, note: 3000 });
const STATUSES = Object.freeze(["new", "contacted", "interested"]);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function listName(value) {
  if (typeof value !== "string") fail(400, "Informe um nome para a lista.");
  const name = value.normalize("NFC").trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) fail(400, "O nome da lista deve ter de 1 a 80 caracteres.");
  return name;
}
function details(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["note", "status"].includes(key)) ||
      typeof value.note !== "string" || value.note.length > LIMITS.note ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.note) || !STATUSES.includes(value.status)) {
    fail(400, "Informe um status válido e uma nota de até 3.000 caracteres.");
  }
  return { note: value.note, status: value.status };
}
function snapshot(row) {
  if (!row || typeof row.osmId !== "string" || !row.osmId || row.osmId.length > 200) fail(400, "Empresa inválida.");
  const result = {};
  const strings = { osmId: 200, name: 400, category: 400, city: 1000, address: 2000, phone: 200,
    website: 2000, status: 100, source: 2000, reason: 4000 };
  for (const [key, max] of Object.entries(strings)) result[key] = typeof row[key] === "string" ? row[key].slice(0, max) : "";
  for (const key of ["confidence", "prospectScore", "latitude", "longitude"]) {
    if (Number.isFinite(row[key])) result[key] = row[key];
  }
  return result;
}

function createProspectStore({ pool, ready, transaction, cipher, uuid }) {
  const listData = row => ({ id: row.id, name: cipher.decrypt(row.name_encrypted, `list:${row.account_id}:${row.id}`),
    count: Number(row.count || 0), createdAt: row.created_at, updatedAt: row.updated_at });
  const companyData = row => ({ id: row.id, listId: row.list_id, createdAt: row.created_at, updatedAt: row.updated_at,
    company: cipher.decrypt(row.company_encrypted, `company:${row.account_id}:${row.list_id}:${row.id}`),
    ...cipher.decrypt(row.details_encrypted, `company-details:${row.account_id}:${row.list_id}:${row.id}`) });
  const lock = async (client, accountId) => {
    const { rows } = await client.query("SELECT id FROM prospect_accounts WHERE id=$1 FOR UPDATE", [accountId]);
    if (!rows[0]) fail(401, "Entre novamente para acessar suas listas.");
  };
  const ownList = async (client, accountId, listId) => {
    if (!uuid(listId)) fail(404, "Lista não encontrada.");
    const { rows } = await client.query("SELECT * FROM prospect_lists WHERE id=$1 AND account_id=$2", [listId, accountId]);
    if (!rows[0]) fail(404, "Lista não encontrada.");
    return rows[0];
  };
  return {
    async lists(accountId) {
      await ready();
      const { rows } = await pool.query("SELECT l.*,count(c.id)::integer AS count FROM prospect_lists l LEFT JOIN prospect_list_companies c ON c.list_id=l.id AND c.account_id=l.account_id WHERE l.account_id=$1 GROUP BY l.id ORDER BY l.created_at,l.id", [accountId]);
      return rows.map(listData);
    },
    async createList(accountId, value) {
      const name = listName(value), id = crypto.randomUUID();
      return transaction(async client => {
        await lock(client, accountId);
        const size = (await client.query("SELECT count(*)::integer AS total FROM prospect_lists WHERE account_id=$1", [accountId])).rows[0].total;
        if (size >= LIMITS.lists) fail(409, "Você atingiu o limite de 20 listas. Exclua uma lista para criar outra.");
        const { rows } = await client.query("INSERT INTO prospect_lists(id,account_id,name_encrypted) VALUES($1,$2,$3) RETURNING *",
          [id, accountId, cipher.encrypt(name, `list:${accountId}:${id}`)]);
        return listData(rows[0]);
      });
    },
    async renameList(accountId, id, value) {
      const name = listName(value);
      return transaction(async client => {
        await lock(client, accountId); await ownList(client, accountId, id);
        await client.query("UPDATE prospect_lists SET name_encrypted=$3,updated_at=now() WHERE id=$1 AND account_id=$2", [id, accountId, cipher.encrypt(name, `list:${accountId}:${id}`)]);
        return { ok: true };
      });
    },
    async deleteList(accountId, id) {
      return transaction(async client => {
        await lock(client, accountId); await ownList(client, accountId, id);
        await client.query("DELETE FROM prospect_lists WHERE id=$1 AND account_id=$2", [id, accountId]);
        return { ok: true };
      });
    },
    async listCompanies(accountId, id) {
      await ready(); await ownList(pool, accountId, id);
      const { rows } = await pool.query("SELECT * FROM prospect_list_companies WHERE list_id=$1 AND account_id=$2 ORDER BY created_at DESC,id LIMIT $3", [id, accountId, LIMITS.companiesPerList]);
      return rows.map(companyData);
    },
    async saveCompany(accountId, listId, row) {
      const company = snapshot(row), key = cipher.mac("saved-company", `${accountId}:${company.osmId}`);
      return transaction(async client => {
        await lock(client, accountId); await ownList(client, accountId, listId);
        const existing = (await client.query("SELECT * FROM prospect_list_companies WHERE account_id=$1 AND list_id=$2 AND company_key=$3", [accountId, listId, key])).rows[0];
        // Repeated clicks must preserve the user's existing notes and contact status.
        if (existing) return { created: false, item: companyData(existing) };
        const size = (await client.query("SELECT count(*)::integer AS total,count(*) FILTER(WHERE list_id=$2)::integer AS in_list FROM prospect_list_companies WHERE account_id=$1", [accountId, listId])).rows[0];
        if (size.in_list >= LIMITS.companiesPerList) fail(409, "Esta lista chegou a 250 empresas. Escolha outra lista.");
        if (size.total >= LIMITS.companiesPerAccount) fail(409, "Sua conta chegou a 1.000 empresas salvas. Remova empresas antes de salvar outras.");
        const id = crypto.randomUUID();
        const { rows } = await client.query("INSERT INTO prospect_list_companies(id,account_id,list_id,company_key,company_encrypted,details_encrypted) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [id, accountId, listId, key, cipher.encrypt(company, `company:${accountId}:${listId}:${id}`),
            cipher.encrypt({ note: "", status: "new" }, `company-details:${accountId}:${listId}:${id}`)]);
        await client.query("UPDATE prospect_lists SET updated_at=now() WHERE id=$1 AND account_id=$2", [listId, accountId]);
        return { created: true, item: companyData(rows[0]) };
      });
    },
    async updateCompany(accountId, listId, id, value) {
      const clean = details(value);
      if (!uuid(id)) fail(404, "Empresa salva não encontrada.");
      return transaction(async client => {
        await lock(client, accountId); await ownList(client, accountId, listId);
        const { rows } = await client.query("UPDATE prospect_list_companies SET details_encrypted=$4,updated_at=now() WHERE id=$1 AND list_id=$2 AND account_id=$3 RETURNING *",
          [id, listId, accountId, cipher.encrypt(clean, `company-details:${accountId}:${listId}:${id}`)]);
        if (!rows[0]) fail(404, "Empresa salva não encontrada.");
        return companyData(rows[0]);
      });
    },
    async deleteCompany(accountId, listId, id) {
      if (!uuid(id)) fail(404, "Empresa salva não encontrada.");
      return transaction(async client => {
        await lock(client, accountId); await ownList(client, accountId, listId);
        const { rows } = await client.query("DELETE FROM prospect_list_companies WHERE id=$1 AND list_id=$2 AND account_id=$3 RETURNING id", [id, listId, accountId]);
        if (!rows[0]) fail(404, "Empresa salva não encontrada.");
        return { ok: true };
      });
    }
  };
}
module.exports = { createProspectStore, LIMITS, STATUSES, listName, details, snapshot };
