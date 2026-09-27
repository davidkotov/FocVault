import type { Db } from './index'

/**
 * Versionierte Migrationen (nur vorwärts). Nie eine bestehende Migration ändern –
 * immer eine neue anhängen. Schema-Grundlage: ARCHITECTURE §7.
 * Zero-Knowledge: keine Spalte enthält Dateinamen, MIME-Typen oder Klartext-Inhalte.
 */
const MIGRATIONS: Array<{ version: number; name: string; sql: string }> = [
  {
    version: 1,
    name: 'accounts_auth_vault_objects',
    sql: `
      CREATE TABLE accounts (
        id uuid PRIMARY KEY,
        email text NOT NULL UNIQUE,
        email_verified_at timestamptz,
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','readonly','suspended','deleted')),
        plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','family','business')),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      -- Server-seitige Hashes der clientseitig abgeleiteten Auth-Keys (nie Passphrase/KEK).
      CREATE TABLE auth_secrets (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('passphrase','recovery')),
        hash bytea NOT NULL,
        salt bytea NOT NULL,
        params jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, kind)
      );

      -- Master-Key, gewrappt durch je einen KEK. Der Server kann keinen davon öffnen.
      CREATE TABLE account_keys (
        id uuid PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kek_type text NOT NULL CHECK (kek_type IN ('passphrase','passkey','recovery','wallet')),
        kek_id text NOT NULL DEFAULT 'default',
        mk_iv bytea NOT NULL,
        mk_wrapped bytea NOT NULL,
        kdf_params jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz
      );
      CREATE UNIQUE INDEX account_keys_active ON account_keys (account_id, kek_type, kek_id) WHERE revoked_at IS NULL;

      CREATE TABLE sessions (
        id uuid PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        token_hash bytea NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        strong_auth_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz,
        user_agent text
      );
      CREATE INDEX sessions_account ON sessions (account_id);

      CREATE TABLE vault_indexes (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        version bigint NOT NULL CHECK (version > 0),
        storage_key text NOT NULL,
        size integer NOT NULL,
        sha256 bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, version)
      );

      CREATE TABLE objects (
        id uuid PRIMARY KEY,
        owner_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        state text NOT NULL CHECK (state IN ('uploading','stored','failed','deleted')),
        fmt text NOT NULL,
        cipher_bytes bigint NOT NULL CHECK (cipher_bytes >= 0),
        piece_count integer NOT NULL CHECK (piece_count > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        stored_at timestamptz,
        deleted_at timestamptz
      );
      CREATE INDEX objects_owner_state ON objects (owner_account_id, state);

      CREATE TABLE object_pieces (
        object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
        piece_index integer NOT NULL CHECK (piece_index >= 0),
        storage_key text NOT NULL,
        cipher_bytes bigint NOT NULL CHECK (cipher_bytes > 0),
        PRIMARY KEY (object_id, piece_index)
      );

      CREATE TABLE usage_ledger (
        id bigserial PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        delta_bytes bigint NOT NULL,
        reason text NOT NULL CHECK (reason IN ('store','delete','adjust')),
        object_id uuid,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX usage_ledger_account ON usage_ledger (account_id, at);

      CREATE TABLE audit_events (
        id bigserial PRIMARY KEY,
        account_id uuid,
        actor text NOT NULL CHECK (actor IN ('user','system','admin')),
        kind text NOT NULL,
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX audit_events_account ON audit_events (account_id, at);
    `
  }
]

export async function migrate(db: Db): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  const rows = await db.query<{ version: number }>('SELECT version FROM schema_migrations')
  const applied = new Set(rows.map(r => Number(r.version)))
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    await db.tx(async tx => {
      await tx.exec(m.sql)
      await tx.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [m.version, m.name])
    })
  }
}
