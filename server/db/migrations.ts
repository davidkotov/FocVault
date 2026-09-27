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
  },
  {
    version: 2,
    name: 'wallet_login_reown',
    sql: `
      -- Login per Reown (Wallet, E-Mail-/Social-Wallet): E-Mail wird optional.
      ALTER TABLE accounts ALTER COLUMN email DROP NOT NULL;
      -- Anzeigename (z. B. E-Mail-Hinweis aus Reown oder gekürzte Adresse), nicht verifiziert, nicht eindeutig.
      ALTER TABLE accounts ADD COLUMN label text;

      CREATE TABLE auth_wallets (
        address text PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_login_at timestamptz
      );
      CREATE INDEX auth_wallets_account ON auth_wallets (account_id);

      -- SIWE-Nonces: einmalig, 10 Minuten gültig (Schutz vor Replay).
      CREATE TABLE auth_nonces (
        nonce text PRIMARY KEY,
        expires_at timestamptz NOT NULL,
        used_at timestamptz
      );
    `
  },
  {
    version: 3,
    name: 'billing_addons_payg_settings',
    sql: `
      -- Admin-Einstellungen (Preisbuch, Krypto-Reserve) als versionierbares JSON.
      CREATE TABLE settings (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid
      );

      -- Zusatzspeicher für Abos (Pro/Family). Preis wird beim Kauf festgeschrieben.
      CREATE TABLE account_addons (
        id uuid PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        pack_id text,
        bytes bigint NOT NULL CHECK (bytes > 0),
        chf_per_month numeric(10, 2) NOT NULL CHECK (chf_per_month >= 0),
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
        source text NOT NULL CHECK (source IN ('admin', 'stripe', 'dev')),
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        cancelled_at timestamptz
      );
      CREATE INDEX account_addons_active ON account_addons (account_id) WHERE status = 'active';

      -- Pay-as-you-go für Free-Konten: Speicher über der Free-Quota bis zur Obergrenze.
      ALTER TABLE accounts ADD COLUMN payg_enabled boolean NOT NULL DEFAULT false;
      ALTER TABLE accounts ADD COLUMN payg_cap_gb integer;
      ALTER TABLE accounts ADD COLUMN last_login_at timestamptz;

      -- Tagesstand pro Plan (Verlauf im Admin, Grundlage der Monatsabrechnung).
      CREATE TABLE platform_daily (
        day date NOT NULL,
        plan text NOT NULL,
        accounts integer NOT NULL,
        stored_bytes bigint NOT NULL,
        PRIMARY KEY (day, plan)
      );
    `
  },
  {
    version: 4,
    name: 'multi_currency_yearly',
    sql: `
      -- Währung und Abrechnungsintervall pro Konto (Abo, Zusatzspeicher, PAYG folgen dem Konto).
      ALTER TABLE accounts ADD COLUMN currency text NOT NULL DEFAULT 'CHF' CHECK (currency IN ('CHF', 'EUR', 'USD'));
      ALTER TABLE accounts ADD COLUMN billing_interval text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month', 'year'));

      -- Zusatzspeicher: Preis gilt pro Intervall in der Kontowährung.
      ALTER TABLE account_addons RENAME COLUMN chf_per_month TO price;
      ALTER TABLE account_addons ADD COLUMN currency text NOT NULL DEFAULT 'CHF' CHECK (currency IN ('CHF', 'EUR', 'USD'));
      ALTER TABLE account_addons ADD COLUMN billing_interval text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month', 'year'));

      -- Preisbuch v1 (nur CHF) ist mit v2 nicht kompatibel → Standardwerte v2 greifen.
      DELETE FROM settings WHERE key = 'pricing';
    `
  },
  {
    version: 5,
    name: 'filecoin_onchain_cloud',
    sql: `
      -- Pakete auf Filecoin Onchain Cloud: viele verschlüsselte Pieces werden zu einem FOC-Piece
      -- (bis ~1 GiB) gebündelt – die FOC-Gebühren fallen pro Piece an, nicht pro Byte.
      CREATE TABLE foc_packs (
        id uuid PRIMARY KEY,
        network text NOT NULL CHECK (network IN ('mainnet', 'calibration')),
        state text NOT NULL CHECK (state IN ('stored', 'removing', 'removed')),
        bytes bigint NOT NULL CHECK (bytes > 0),
        piece_cid text NOT NULL,
        copies jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        removal_requested_at timestamptz
      );
      CREATE INDEX foc_packs_state ON foc_packs (state);

      -- Welche Storage-Keys in welchem Paket liegen (Byte-Bereich). deleted_at = Key gelöscht,
      -- evicted_at = schnelle Kopie (Fil One / lokal) entfernt, gelesen wird dann von Filecoin.
      CREATE TABLE foc_members (
        storage_key text PRIMARY KEY,
        pack_id uuid NOT NULL REFERENCES foc_packs(id),
        byte_offset bigint NOT NULL CHECK (byte_offset >= 0),
        byte_length bigint NOT NULL CHECK (byte_length > 0),
        deleted_at timestamptz,
        evicted_at timestamptz
      );
      CREATE INDEX foc_members_pack ON foc_members (pack_id);
    `
  },
  {
    version: 6,
    name: 'secure_send_accounts',
    sql: `
      -- Secure Send im Konto-Modus: der Link verweist auf eine gespeicherte Datei (keine Kopie).
      -- meta ist mit dem Link-Schlüssel verschlüsselt (liegt nur im URL-Fragment beim Empfänger).
      CREATE TABLE shares (
        id text PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
        meta bytea NOT NULL,
        expires_at timestamptz,
        max_downloads integer CHECK (max_downloads IS NULL OR max_downloads > 0),
        downloads integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz
      );
      CREATE INDEX shares_account ON shares (account_id, created_at DESC);
      CREATE INDEX shares_object ON shares (object_id);
    `
  },
  {
    version: 7,
    name: 'trash',
    sql: `
      -- Papierkorb (Pro/Family): Dateien bleiben bis purge_after wiederherstellbar und zählen zur Quota.
      ALTER TABLE objects DROP CONSTRAINT objects_state_check;
      ALTER TABLE objects ADD CONSTRAINT objects_state_check CHECK (state IN ('uploading','stored','trashed','failed','deleted'));
      ALTER TABLE objects ADD COLUMN trashed_at timestamptz;
      ALTER TABLE objects ADD COLUMN purge_after timestamptz;
      CREATE INDEX objects_purge ON objects (purge_after) WHERE state = 'trashed';
    `
  },
  {
    version: 8,
    name: 'stripe_billing',
    sql: `
      -- Stripe: Kunde, Abo-Status und Laufzeit am Konto; Zusatzspeicher als Abo-Position.
      ALTER TABLE accounts ADD COLUMN stripe_customer_id text UNIQUE;
      ALTER TABLE accounts ADD COLUMN stripe_subscription_id text UNIQUE;
      ALTER TABLE accounts ADD COLUMN subscription_status text;
      ALTER TABLE accounts ADD COLUMN current_period_end timestamptz;
      ALTER TABLE accounts ADD COLUMN cancel_at_period_end boolean NOT NULL DEFAULT false;
      ALTER TABLE account_addons ADD COLUMN stripe_item_id text UNIQUE;

      -- Webhooks genau einmal verarbeiten (Stripe liefert mindestens einmal).
      CREATE TABLE stripe_events (
        id text PRIMARY KEY,
        type text NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now()
      );

      -- Pay-as-you-go: täglicher Stand je Konto → Monatsdurchschnitt; Monatsabschluss mit Übertrag.
      CREATE TABLE usage_daily (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        day date NOT NULL,
        bytes bigint NOT NULL CHECK (bytes >= 0),
        PRIMARY KEY (account_id, day)
      );
      CREATE TABLE payg_invoices (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        period text NOT NULL,
        billable_gb double precision NOT NULL,
        amount numeric(12, 2) NOT NULL,
        carried_in numeric(12, 2) NOT NULL DEFAULT 0,
        carried_out numeric(12, 2) NOT NULL DEFAULT 0,
        currency text NOT NULL CHECK (currency IN ('CHF', 'EUR', 'USD')),
        status text NOT NULL CHECK (status IN ('carried', 'charged', 'failed', 'recorded')),
        stripe_invoice_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, period)
      );
    `
  },
  {
    version: 9,
    name: 'file_versions',
    sql: `
      -- Dateiversionen (Pro/Family): ältere Fassungen bleiben als 'version' bis purge_after erhalten.
      ALTER TABLE objects DROP CONSTRAINT objects_state_check;
      ALTER TABLE objects ADD CONSTRAINT objects_state_check CHECK (state IN ('uploading','stored','version','trashed','failed','deleted'));
      DROP INDEX objects_purge;
      CREATE INDEX objects_purge ON objects (purge_after) WHERE state IN ('trashed', 'version');
    `
  },
  {
    version: 10,
    name: 'family',
    sql: `
      -- Family: ein Abo, gemeinsamer Speicher, jedes Mitglied mit eigenem Konto und eigenem Tresor.
      CREATE TABLE families (
        owner_account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE family_members (
        account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        owner_account_id uuid NOT NULL REFERENCES families(owner_account_id) ON DELETE CASCADE,
        joined_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX family_members_owner ON family_members (owner_account_id);
      CREATE TABLE family_invites (
        id uuid PRIMARY KEY,
        owner_account_id uuid NOT NULL REFERENCES families(owner_account_id) ON DELETE CASCADE,
        token_hash bytea NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        used_at timestamptz,
        used_by uuid,
        revoked_at timestamptz
      );
    `
  },
  {
    version: 11,
    name: 'foc_member_hash',
    sql: `
      -- SHA-256 jedes gesicherten Ciphertext-Teils: Grundlage des Nachweises (Zertifikat).
      ALTER TABLE foc_members ADD COLUMN sha256 bytea;
    `
  },
  {
    version: 12,
    name: 'family_space',
    sql: `
      -- Familienordner: gemeinsame Dateien, verschlüsselt mit einem Ordner-Schlüssel, den nur
      -- Mitglieder kennen. Jedes Konto hat ein öffentliches ECDH-Schlüsselpaar (privater Teil im
      -- eigenen verschlüsselten Tresor); der Ordner-Schlüssel wird je Mitglied dafür verpackt.
      CREATE TABLE account_pubkeys (
        account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        public_key jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE family_space_keys (
        owner_account_id uuid NOT NULL REFERENCES families(owner_account_id) ON DELETE CASCADE,
        generation integer NOT NULL CHECK (generation > 0),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        wrapped jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (owner_account_id, generation, account_id)
      );
      CREATE TABLE family_space_index (
        owner_account_id uuid PRIMARY KEY REFERENCES families(owner_account_id) ON DELETE CASCADE,
        version bigint NOT NULL,
        body bytea NOT NULL,
        rotate_needed boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      -- Objekte im Familienordner: gehören dem hochladenden Konto (Quota-Pool), sind aber für
      -- alle Mitglieder der Familie abrufbar.
      ALTER TABLE objects ADD COLUMN space_owner uuid REFERENCES families(owner_account_id) ON DELETE SET NULL;
      CREATE INDEX objects_space ON objects (space_owner) WHERE space_owner IS NOT NULL;
    `
  },
  {
    version: 13,
    name: 's3_api',
    sql: `
      -- Speicher-API (S3-kompatibel, Business). Werkzeuge wie restic/pgBackRest/WAL-G verschlüsseln
      -- selbst; wir speichern ihre Objekte als normale Objekte (Quota, Filecoin-Sicherung, Abrechnung).
      CREATE TABLE s3_keys (
        access_key text PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        secret_enc text NOT NULL,
        label text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz,
        revoked_at timestamptz
      );
      CREATE INDEX s3_keys_account ON s3_keys (account_id);
      CREATE TABLE s3_buckets (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name text NOT NULL,
        object_lock boolean NOT NULL DEFAULT false,
        lock_mode text CHECK (lock_mode IN ('GOVERNANCE', 'COMPLIANCE')),
        lock_days integer CHECK (lock_days IS NULL OR lock_days BETWEEN 1 AND 36500),
        retention jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, name)
      );
      CREATE TABLE s3_objects (
        account_id uuid NOT NULL,
        bucket text NOT NULL,
        key text NOT NULL,
        object_id uuid NOT NULL REFERENCES objects(id),
        size bigint NOT NULL,
        etag text NOT NULL,
        content_type text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        lock_mode text CHECK (lock_mode IN ('GOVERNANCE', 'COMPLIANCE')),
        retain_until timestamptz,
        PRIMARY KEY (account_id, bucket, key),
        FOREIGN KEY (account_id, bucket) REFERENCES s3_buckets(account_id, name) ON DELETE CASCADE
      );
      CREATE INDEX s3_objects_list ON s3_objects (account_id, bucket, key text_pattern_ops);
      CREATE TABLE s3_uploads (
        upload_id text PRIMARY KEY,
        account_id uuid NOT NULL,
        bucket text NOT NULL,
        key text NOT NULL,
        object_id uuid NOT NULL REFERENCES objects(id),
        content_type text NOT NULL,
        lock_mode text,
        retain_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (account_id, bucket) REFERENCES s3_buckets(account_id, name) ON DELETE CASCADE
      );
      CREATE TABLE s3_parts (
        upload_id text NOT NULL REFERENCES s3_uploads(upload_id) ON DELETE CASCADE,
        part_number integer NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
        size bigint NOT NULL,
        etag text NOT NULL,
        PRIMARY KEY (upload_id, part_number)
      );
      -- Leere Objekte (0 Byte) sind in S3 üblich
      ALTER TABLE object_pieces DROP CONSTRAINT object_pieces_cipher_bytes_check;
      ALTER TABLE object_pieces ADD CONSTRAINT object_pieces_cipher_bytes_check CHECK (cipher_bytes >= 0);
    `
  },
  {
    version: 14,
    name: 'business_tiers_seats',
    sql: `
      -- Business in drei Stufen; Nutzerplätze (inklusive + zusätzlich gebuchte).
      ALTER TABLE accounts ADD COLUMN business_tier text CHECK (business_tier IN ('starter', 'business', 'enterprise'));
      ALTER TABLE accounts ADD COLUMN seats integer CHECK (seats IS NULL OR seats BETWEEN 1 AND 100000);
      -- Enterprise: individuelle Quota (vom Admin gesetzt)
      ALTER TABLE accounts ADD COLUMN custom_quota_gb integer CHECK (custom_quota_gb IS NULL OR custom_quota_gb > 0);
    `
  },
  {
    version: 15,
    name: 'multi_file_shares',
    sql: `
      -- Secure Send mit mehreren Dateien: ein Link, mehrere Objekte (Reihenfolge = position).
      CREATE TABLE share_items (
        share_id text NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
        position integer NOT NULL CHECK (position >= 0),
        object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
        PRIMARY KEY (share_id, position)
      );
      INSERT INTO share_items (share_id, position, object_id) SELECT id, 0, object_id FROM shares;
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
