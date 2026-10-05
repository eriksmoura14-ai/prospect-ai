BEGIN;
SELECT pg_advisory_xact_lock(741326951);
CREATE TABLE IF NOT EXISTS prospect_accounts (
  id uuid PRIMARY KEY,
  email_hash char(64) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  profile_encrypted text NOT NULL,
  preferences_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  email_verified_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS prospect_sessions (
  token_hash char(64) PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES prospect_accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospect_sessions_account ON prospect_sessions(account_id);
CREATE INDEX IF NOT EXISTS prospect_sessions_expiry ON prospect_sessions(expires_at);
CREATE TABLE IF NOT EXISTS prospect_email_tokens (
  token_hash char(64) PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('activate', 'reset')),
  email_hash char(64) NOT NULL,
  account_id uuid REFERENCES prospect_accounts(id) ON DELETE CASCADE,
  payload_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS prospect_email_expiry ON prospect_email_tokens(expires_at);
CREATE INDEX IF NOT EXISTS prospect_email_owner ON prospect_email_tokens(email_hash);
CREATE TABLE IF NOT EXISTS prospect_rate_limits (
  key_hash char(64) PRIMARY KEY,
  count integer NOT NULL,
  window_end timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS prospect_searches (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES prospect_accounts(id) ON DELETE CASCADE,
  summary_encrypted text NOT NULL,
  payload_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
CREATE INDEX IF NOT EXISTS prospect_searches_owner ON prospect_searches(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prospect_searches_expiry ON prospect_searches(expires_at);
COMMIT;
