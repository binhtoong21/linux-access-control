"""edge.db schema (07-data/data-model.md §3) as ordered migrations keyed by PRAGMA user_version (migrations.md §1.2).

Migrations contain DDL only; connection PRAGMAs (WAL, synchronous=FULL, foreign_keys) are set by the store before
any transaction because SQLite ignores or rejects them inside one.
"""

MIGRATIONS: list[str] = [
    # 0 -> 1: baseline
    """
    CREATE TABLE agent_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        mqtt_identity TEXT NOT NULL,
        boot_id TEXT NOT NULL,
        local_key_version INTEGER NOT NULL CHECK (local_key_version >= 1),
        updated_at REAL NOT NULL
    );
    CREATE TABLE local_liveness (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        boot_id TEXT NOT NULL,
        last_alive_at REAL NOT NULL
    );
    CREATE TABLE snapshot_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL DEFAULT 0,
        key_version INTEGER NOT NULL DEFAULT 1,
        uid_scheme TEXT NOT NULL DEFAULT 'hmac-sha256-v1',
        snapshot_created_at REAL NOT NULL DEFAULT 0,
        received_at REAL NOT NULL DEFAULT 0,
        trusted_until REAL NOT NULL DEFAULT 0,
        last_sync_local_time REAL NOT NULL DEFAULT 0,
        lease_duration_sec INTEGER NOT NULL DEFAULT 86400,
        warning_before_sec INTEGER NOT NULL DEFAULT 300,
        max_session_duration_sec INTEGER NOT NULL DEFAULT 43200,
        hmac_signature TEXT NOT NULL DEFAULT '',
        last_apply_error TEXT NULL
    );
    INSERT INTO snapshot_meta (id) VALUES (1);
    CREATE TABLE snapshot_users (
        user_id TEXT PRIMARY KEY,
        external_id TEXT NOT NULL,
        full_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'inactive'))
    );
    CREATE TABLE snapshot_user_groups (
        user_id TEXT NOT NULL REFERENCES snapshot_users(user_id) ON DELETE CASCADE,
        group_id TEXT NOT NULL,
        PRIMARY KEY (user_id, group_id)
    );
    CREATE INDEX idx_edge_ug_group ON snapshot_user_groups (group_id);
    CREATE TABLE snapshot_cards (
        card_match_key TEXT PRIMARY KEY,
        card_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES snapshot_users(user_id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled'))
    );
    CREATE TABLE snapshot_schedules (
        schedule_id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'group')),
        subject_id TEXT NOT NULL,
        valid_from TEXT NOT NULL,
        valid_to TEXT NULL,
        days_mask INTEGER NOT NULL CHECK (days_mask BETWEEN 1 AND 127),
        start_minute INTEGER NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
        end_minute INTEGER NOT NULL CHECK (end_minute > start_minute AND end_minute <= 1440),
        target_os_username TEXT NULL
    );
    CREATE INDEX idx_edge_sched_subj ON snapshot_schedules (subject_type, subject_id);
    CREATE TABLE local_workstation_profiles (
        os_username TEXT PRIMARY KEY,
        present_locally INTEGER NOT NULL DEFAULT 0 CHECK (present_locally IN (0, 1)),
        in_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (in_snapshot IN (0, 1)),
        status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('enabled', 'disabled')),
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
    );
    CREATE UNIQUE INDEX uq_edge_default_profile ON local_workstation_profiles (is_default) WHERE is_default = 1;
    CREATE TABLE local_sessions (
        session_id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        os_username TEXT NOT NULL,
        os_session_id TEXT NULL,
        boot_id TEXT NOT NULL,
        decided_at REAL NOT NULL,
        started_at REAL NULL,
        expires_at REAL NOT NULL,
        boottime_limit REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'active', 'completed', 'forced_logout', 'abandoned', 'discarded')),
        ended_at REAL NULL,
        end_reason TEXT NULL CHECK (end_reason IS NULL OR end_reason IN
            ('user_logout', 'schedule_expired', 'workstation_rebooted', 'superseded', 'os_session_lost')),
        end_source TEXT NULL CHECK (end_source IS NULL OR end_source IN ('reported', 'reconstructed'))
    );
    CREATE UNIQUE INDEX uq_edge_one_pending_session ON local_sessions (status) WHERE status = 'pending';
    CREATE UNIQUE INDEX uq_edge_one_active_session ON local_sessions (status) WHERE status = 'active';
    CREATE INDEX idx_edge_sessions_cleanup ON local_sessions (status, ended_at);
    CREATE TABLE audit_outbox (
        outbox_seq INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id TEXT NOT NULL UNIQUE,
        occurred_at REAL NOT NULL,
        event_type TEXT NOT NULL
            CHECK (event_type IN ('swipe_decision', 'session_started', 'session_ended', 'security_alert')),
        payload_json TEXT NOT NULL,
        created_at REAL NOT NULL
    );
    """,
]

CONNECTION_PRAGMAS = (
    "PRAGMA journal_mode = WAL",
    "PRAGMA synchronous = FULL",
    "PRAGMA busy_timeout = 5000",
    "PRAGMA foreign_keys = ON",
    "PRAGMA wal_autocheckpoint = 1000",
)
