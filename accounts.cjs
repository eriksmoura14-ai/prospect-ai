"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function vault(encodedKey) {
  if (typeof encodedKey !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) {
    throw new Error("DATA_ENCRYPTION_KEY deve ser uma chave aleatória de 32 bytes em base64.");
  }
  const master = Buffer.from(encodedKey, "base64");
  if (master.length !== 32) throw new Error("DATA_ENCRYPTION_KEY inválida.");
  const key = purpose => Buffer.from(crypto.hkdfSync("sha256", master,
    Buffer.from("ProspectAI accounts v1"), Buffer.from(purpose), 32));
  const encrypt = (value, context) => {
    const text = Buffer.from(JSON.stringify(value));
    if (text.length > 2 * 1024 * 1024) throw new Error("Dados excedem o limite de armazenamento.");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key("encryption"), iv);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(text), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
  };
  const decrypt = (encoded, context) => {
    const [version, nonce, tag, body, extra] = String(encoded).split(".");
    if (version !== "v1" || extra !== undefined || !nonce || !tag || !body) throw new Error("Dados cifrados inválidos.");
    const iv = Buffer.from(nonce, "base64url"), authTag = Buffer.from(tag, "base64url");
    if (iv.length !== 12 || authTag.length !== 16) throw new Error("Dados cifrados inválidos.");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key("encryption"), iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(authTag);
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString());
  };
  const mac = (purpose, value) => crypto.createHmac("sha256", key(purpose)).update(value).digest("hex");
  return { encrypt, decrypt, mac };
}

function databaseOptions(connectionString, local = false) {
  let url;
  try { url = new URL(connectionString); }
  catch { throw new Error("DATABASE_URL inválida. Configure a conexão PostgreSQL autenticada no ambiente."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password) {
    throw new Error("DATABASE_URL deve ser uma conexão PostgreSQL autenticada.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && loopback) throw new Error("Banco local não é permitido no modo hospedado.");
  for (const key of [...url.searchParams.keys()]) {
    if (/^ssl/i.test(key)) url.searchParams.delete(key);
  }
  return { connectionString: url.href, ssl: local && loopback ? false : { rejectUnauthorized: true },
    max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 5000, idle_in_transaction_session_timeout: 10000 };
}

function createStore({ databaseUrl, encryptionKey, local = false }) {
  const cipher = vault(encryptionKey);
  const pool = new Pool(databaseOptions(databaseUrl, local));
  pool.on("error", () => console.error("Conexão do banco interrompida; dados privados continuam protegidos."));
  let initialized;
  const ready = () => initialized ||= pool.query(fs.readFileSync(path.join(__dirname, "db/schema.sql"), "utf8"))
    .catch(error => { initialized = null; throw error; });
  const cleanup = async client => {
    await client.query("DELETE FROM prospect_sessions WHERE expires_at <= now()");
    await client.query("DELETE FROM prospect_email_tokens WHERE expires_at <= now()");
    await client.query("DELETE FROM prospect_rate_limits WHERE window_end <= now()");
    await client.query("DELETE FROM prospect_searches WHERE expires_at <= now()");
  };
  const profile = row => ({ id: row.id,
    ...cipher.decrypt(row.profile_encrypted, `profile:${row.id}`),
    preferences: cipher.decrypt(row.preferences_encrypted, `preferences:${row.id}`) });
  const emailHash = email => cipher.mac("gmail", email);
  const transaction = async action => {
    await ready();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const value = await action(client);
      await client.query("COMMIT");
      return value;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  };
  const insertSession = async (client, id, token, previousToken) => {
    if (previousToken) await client.query("DELETE FROM prospect_sessions WHERE token_hash=$1", [hash(previousToken)]);
    await client.query("INSERT INTO prospect_sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [hash(token), id]);
    await client.query("DELETE FROM prospect_sessions WHERE account_id=$1 AND token_hash IN (SELECT token_hash FROM prospect_sessions WHERE account_id=$1 ORDER BY created_at DESC OFFSET 5)", [id]);
  };
  let cleanedAt = 0;
  const maintain = async () => {
    await ready();
    if (Date.now() - cleanedAt < 300000) return;
    cleanedAt = Date.now();
    try { await cleanup(pool); } catch (error) { cleanedAt = 0; throw error; }
  };
  return {
    ready, maintain,
    async close() { await pool.end(); },
    csrf(token) { return cipher.mac("csrf", token); },
    async allow(rules) {
      return transaction(async client => {
        let allowed = true;
        for (const rule of rules) {
          const { rows } = await client.query("INSERT INTO prospect_rate_limits(key_hash,count,window_end) VALUES($1,1,now()+make_interval(secs=>$2)) ON CONFLICT(key_hash) DO UPDATE SET count=CASE WHEN prospect_rate_limits.window_end<=now() THEN 1 ELSE prospect_rate_limits.count+1 END,window_end=CASE WHEN prospect_rate_limits.window_end<=now() THEN EXCLUDED.window_end ELSE prospect_rate_limits.window_end END RETURNING count",
            [cipher.mac("rate", rule.key), rule.seconds]);
          if (rows[0].count > rule.limit) allowed = false;
        }
        return allowed;
      });
    },
    async credentials(email) {
      await ready();
      const { rows } = await pool.query("SELECT id,password_hash FROM prospect_accounts WHERE email_hash=$1", [emailHash(email)]);
      return rows[0] || null;
    },
    async issueEmailToken(purpose, email, token) {
      await maintain();
      return transaction(async client => {
        const owner = emailHash(email);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [owner]);
        const account = (await client.query("SELECT id FROM prospect_accounts WHERE email_hash=$1", [owner])).rows[0];
        await client.query("DELETE FROM prospect_email_tokens WHERE email_hash=$1 AND purpose=$2", [owner, purpose]);
        await client.query("INSERT INTO prospect_email_tokens(token_hash,purpose,email_hash,account_id,payload_encrypted,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes')",
          [hash(token), purpose, owner, account?.id || null, cipher.encrypt({ email }, `email:${hash(token)}`)]);
      });
    },
    async validEmailToken(purpose, token) {
      await ready();
      const { rows } = await pool.query("SELECT 1 FROM prospect_email_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() AND ($2='activate' OR account_id IS NOT NULL)", [hash(token), purpose]);
      return Boolean(rows[0]);
    },
    async consumeEmailToken(purpose, value, passwordHash, sessionToken, previousToken) {
      return transaction(async client => {
        const pending = (await client.query("SELECT email_hash FROM prospect_email_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>now()", [hash(value), purpose])).rows[0];
        if (!pending) return null;
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [pending.email_hash]);
        const item = (await client.query("DELETE FROM prospect_email_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() RETURNING *", [hash(value), purpose])).rows[0];
        if (!item) return null;
        let account = (await client.query("SELECT * FROM prospect_accounts WHERE email_hash=$1 FOR UPDATE", [item.email_hash])).rows[0];
        if (purpose === "activate") {
          if (account) return null;
          const id = crypto.randomUUID();
          const { email } = cipher.decrypt(item.payload_encrypted, `email:${hash(value)}`);
          account = (await client.query("INSERT INTO prospect_accounts(id,email_hash,password_hash,profile_encrypted,preferences_encrypted) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [id, item.email_hash, passwordHash, cipher.encrypt({ email }, `profile:${id}`), cipher.encrypt({}, `preferences:${id}`)])).rows[0];
        } else {
          if (!account || account.id !== item.account_id) return null;
          account = (await client.query("UPDATE prospect_accounts SET password_hash=$2,last_login_at=now() WHERE id=$1 RETURNING *", [account.id, passwordHash])).rows[0];
          await client.query("DELETE FROM prospect_sessions WHERE account_id=$1", [account.id]);
        }
        await client.query("DELETE FROM prospect_email_tokens WHERE email_hash=$1", [item.email_hash]);
        await insertSession(client, account.id, sessionToken, previousToken);
        return profile(account);
      });
    },
    async signIn(email, expectedHash, token, previousToken) {
      return transaction(async client => {
        const account = (await client.query("SELECT * FROM prospect_accounts WHERE email_hash=$1 FOR UPDATE", [emailHash(email)])).rows[0];
        // A concurrent password reset must invalidate a just-verified old password.
        if (!account || account.password_hash !== expectedHash) return null;
        await insertSession(client, account.id, token, previousToken);
        await client.query("UPDATE prospect_accounts SET last_login_at=now() WHERE id=$1", [account.id]);
        return profile(account);
      });
    },
    async session(token) {
      await ready();
      const { rows } = await pool.query("SELECT a.* FROM prospect_sessions s JOIN prospect_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now()", [hash(token)]);
      return rows[0] ? profile(rows[0]) : null;
    },
    async logout(token) { await ready(); await pool.query("DELETE FROM prospect_sessions WHERE token_hash=$1", [hash(token)]); },
    async preferences(id, value) {
      await ready(); await pool.query("UPDATE prospect_accounts SET preferences_encrypted=$2 WHERE id=$1", [id, cipher.encrypt(value, `preferences:${id}`)]);
    },
    async saveSearch(accountId, job, summary) {
      await ready();
      const data = { ...job }; delete data.ownerId;
      await pool.query("INSERT INTO prospect_searches(id,account_id,summary_encrypted,payload_encrypted) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET payload_encrypted=EXCLUDED.payload_encrypted,summary_encrypted=EXCLUDED.summary_encrypted WHERE prospect_searches.account_id=EXCLUDED.account_id",
        [job.id, accountId, cipher.encrypt(summary, `summary:${accountId}:${job.id}`), cipher.encrypt(data, `search:${accountId}:${job.id}`)]);
      await pool.query("DELETE FROM prospect_searches WHERE account_id=$1 AND (expires_at<=now() OR id IN (SELECT id FROM prospect_searches WHERE account_id=$1 ORDER BY created_at DESC OFFSET 20))", [accountId]);
    },
    async search(accountId, id) {
      if (!uuid(id)) return null;
      await ready();
      const { rows } = await pool.query("SELECT payload_encrypted FROM prospect_searches WHERE id=$1 AND account_id=$2 AND expires_at>now()", [id, accountId]);
      if (!rows[0]) return null;
      const data = cipher.decrypt(rows[0].payload_encrypted, `search:${accountId}:${id}`);
      if (data.state === "running") return { ...data, state: "error", message: "A pesquisa foi interrompida no servidor. Inicie uma nova busca.", errorCode: "interrupted" };
      return data;
    },
    async history(accountId) {
      await ready();
      const { rows } = await pool.query("SELECT id,created_at,summary_encrypted FROM prospect_searches WHERE account_id=$1 AND expires_at>now() ORDER BY created_at DESC LIMIT 20", [accountId]);
      return rows.map(row => ({ id: row.id, createdAt: row.created_at,
        ...cipher.decrypt(row.summary_encrypted, `summary:${accountId}:${row.id}`) }));
    },
    async deleteAccount(accountId, expectedHash) {
      return transaction(async client => {
        const { rows } = await client.query("SELECT email_hash FROM prospect_accounts WHERE id=$1 AND password_hash=$2 FOR UPDATE", [accountId, expectedHash]);
        if (!rows[0]) return false;
        await client.query("DELETE FROM prospect_email_tokens WHERE email_hash=$1", [rows[0].email_hash]);
        await client.query("DELETE FROM prospect_accounts WHERE id=$1", [accountId]);
        return true;
      });
    }
  };
}

module.exports = { createStore, databaseOptions, vault, hash, uuid };
