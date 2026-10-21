/**
 * Ordered schema migrations; index + 1 is the resulting PRAGMA user_version.
 * Never edit an entry once released, append a new one instead.
 * Timestamps are epoch milliseconds (UTC); block `timestamp` is the chain's unix seconds.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    chat_id TEXT NOT NULL,
    telegram_message_id INTEGER NOT NULL,
    last_rendered_text TEXT NOT NULL,
    edited_orphan_count INTEGER NOT NULL DEFAULT 0,
    is_settled INTEGER NOT NULL DEFAULT 0 CHECK (is_settled IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_messages_unsettled ON messages (is_settled, id);

  CREATE TABLE blocks (
    hash TEXT PRIMARY KEY,
    number INTEGER NOT NULL CHECK (number >= 0),
    parent_hash TEXT NOT NULL,
    miner TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    difficulty TEXT NOT NULL,
    nonce TEXT NOT NULL,
    mix_hash TEXT NOT NULL,
    tx_count INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('canonical', 'orphaned')),
    sent INTEGER NOT NULL DEFAULT 0 CHECK (sent IN (0, 1)),
    message_ref INTEGER REFERENCES messages (id) ON DELETE SET NULL,
    streak INTEGER NOT NULL DEFAULT 1,
    block_time_s INTEGER,
    hashrate_hps REAL,
    is_first_for_wallet INTEGER NOT NULL DEFAULT 0 CHECK (is_first_for_wallet IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX idx_blocks_one_canonical_per_number ON blocks (number) WHERE status = 'canonical';
  CREATE INDEX idx_blocks_number ON blocks (number);
  CREATE INDEX idx_blocks_unsent ON blocks (status, sent, number);
  CREATE INDEX idx_blocks_message ON blocks (message_ref);
  CREATE INDEX idx_blocks_timestamp ON blocks (timestamp);
  CREATE INDEX idx_blocks_first_seen ON blocks (first_seen_at);

  CREATE TABLE wallets (
    address TEXT PRIMARY KEY,
    first_block INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE rpc_samples (
    minute_start INTEGER PRIMARY KEY,
    ok_count INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    last_head INTEGER,
    last_peers INTEGER,
    last_syncing INTEGER CHECK (last_syncing IN (0, 1)),
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE incidents (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('rpc_down', 'stalled', 'low_peers', 'syncing')),
    detail TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    resolved_at INTEGER,
    alert_state TEXT NOT NULL CHECK (alert_state IN ('pending', 'sent', 'suppressed')),
    recovery_sent INTEGER NOT NULL DEFAULT 0 CHECK (recovery_sent IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX idx_incidents_one_open_per_kind ON incidents (kind) WHERE resolved_at IS NULL;
  CREATE INDEX idx_incidents_kind_resolved ON incidents (kind, resolved_at);

  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE admins (
    user_id TEXT PRIMARY KEY,
    -- 'claim' for the bootstrap admin, otherwise the user id of the admin who ran /addadmin
    added_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  -- Actions waiting for a second step: a Yakin/Batal confirmation, or a user picker
  -- (KeyboardButtonRequestUsers) whose users_shared reply is still expected.
  CREATE TABLE pending_actions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('unsetchat', 'unsetalert', 'removeadmin', 'pick_admin')),
    argument TEXT,
    user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_pending_actions_expires ON pending_actions (expires_at);
  `,
];
