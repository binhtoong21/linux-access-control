-- Applied by src/infra/database/migrator.ts inside one transaction; do NOT add BEGIN/COMMIT here.

CREATE TABLE workstation_statuses (
  workstation_id UUID PRIMARY KEY REFERENCES workstations(id) ON DELETE CASCADE,
  connectivity VARCHAR(16) NOT NULL DEFAULT 'offline' CONSTRAINT chk_workstation_statuses_connectivity CHECK (connectivity IN ('online', 'offline')),
  last_heartbeat_at TIMESTAMPTZ DEFAULT NULL,
  boot_id VARCHAR(64) DEFAULT NULL,
  trust_state VARCHAR(16) DEFAULT NULL CONSTRAINT chk_workstation_statuses_trust_state CHECK (trust_state IS NULL OR trust_state IN ('NoData', 'Fresh', 'Expired', 'ClockInvalid')),
  clock_skew_detected BOOLEAN NOT NULL DEFAULT false,
  last_apply_error TEXT DEFAULT NULL,
  reconcile_state VARCHAR(16) NOT NULL DEFAULT 'Idle' CONSTRAINT chk_workstation_statuses_reconcile_state CHECK (reconcile_state IN ('Idle', 'Draining')),
  draining_started_at TIMESTAMPTZ DEFAULT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  decision_id UUID NOT NULL CONSTRAINT uq_sessions_decision_id UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  card_id UUID DEFAULT NULL REFERENCES cards(id),
  workstation_id UUID NOT NULL REFERENCES workstations(id),
  os_username VARCHAR(32) NOT NULL,
  boot_id VARCHAR(64) NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CONSTRAINT chk_sessions_status CHECK (status IN ('active', 'completed', 'forced_logout', 'abandoned')),
  ended_at TIMESTAMPTZ DEFAULT NULL,
  end_reason VARCHAR(32) DEFAULT NULL CONSTRAINT chk_sessions_end_reason CHECK (end_reason IS NULL OR end_reason IN ('user_logout', 'schedule_expired', 'workstation_rebooted', 'superseded', 'os_session_lost')),
  end_source VARCHAR(16) DEFAULT NULL CONSTRAINT chk_sessions_end_source CHECK (end_source IS NULL OR end_source IN ('reported', 'reconstructed', 'inferred')),
  CONSTRAINT chk_sessions_lifecycle CHECK ((status = 'active' AND ended_at IS NULL AND end_reason IS NULL AND end_source IS NULL) OR (status <> 'active' AND ended_at IS NOT NULL AND ended_at >= started_at AND end_reason IS NOT NULL AND end_source IS NOT NULL))
);

CREATE UNIQUE INDEX uq_sessions_active_ws ON sessions (workstation_id) WHERE status = 'active';
CREATE INDEX idx_sessions_ws_started ON sessions (workstation_id, started_at DESC);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL CONSTRAINT uq_audit_logs_entry_id UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  workstation_id UUID NOT NULL REFERENCES workstations(id),
  outcome VARCHAR(16) NOT NULL CONSTRAINT chk_audit_logs_outcome CHECK (outcome IN ('granted', 'denied', 'error', 'noop')),
  reason VARCHAR(32) NOT NULL,
  detail VARCHAR(64) DEFAULT NULL,
  card_uid_encrypted BYTEA DEFAULT NULL,
  card_uid_iv BYTEA DEFAULT NULL,
  card_uid_auth_tag BYTEA DEFAULT NULL,
  encryption_key_id VARCHAR(32) DEFAULT NULL,
  card_uid_index CHAR(64) DEFAULT NULL,
  reader_raw VARCHAR(128) DEFAULT NULL,
  user_snapshot JSONB DEFAULT NULL,
  card_snapshot JSONB DEFAULT NULL,
  workstation_snapshot JSONB NOT NULL,
  target_os_username VARCHAR(32) DEFAULT NULL,
  data_version BIGINT DEFAULT NULL,
  matched_schedule_ids UUID[] DEFAULT NULL,
  CONSTRAINT chk_audit_uid_enc CHECK ((card_uid_encrypted IS NULL AND card_uid_iv IS NULL AND card_uid_auth_tag IS NULL AND encryption_key_id IS NULL) OR (card_uid_encrypted IS NOT NULL AND octet_length(card_uid_iv) = 12 AND octet_length(card_uid_auth_tag) = 16 AND encryption_key_id IS NOT NULL))
);

CREATE INDEX idx_audit_occurred_desc ON audit_logs (occurred_at DESC);
CREATE INDEX idx_audit_ws_occurred ON audit_logs (workstation_id, occurred_at DESC);
CREATE INDEX idx_audit_card_idx ON audit_logs (card_uid_index, occurred_at DESC) WHERE card_uid_index IS NOT NULL;
CREATE INDEX idx_audit_user_id ON audit_logs ((user_snapshot->>'id'), occurred_at DESC) WHERE user_snapshot IS NOT NULL;

CREATE TABLE ingest_rejects (
  id BIGSERIAL PRIMARY KEY,
  workstation_id UUID NOT NULL REFERENCES workstations(id),
  entry_id VARCHAR(64) DEFAULT NULL,
  outbox_seq BIGINT DEFAULT NULL,
  raw_record JSONB NOT NULL,
  error VARCHAR(255) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ DEFAULT NULL,
  resolved_by UUID DEFAULT NULL REFERENCES admin_accounts(id),
  note TEXT DEFAULT NULL
);

CREATE INDEX idx_ingest_rejects_open ON ingest_rejects (workstation_id, received_at DESC) WHERE resolved_at IS NULL;

CREATE TABLE workstation_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL CONSTRAINT uq_workstation_alerts_entry_id UNIQUE,
  workstation_id UUID NOT NULL REFERENCES workstations(id),
  kind VARCHAR(32) NOT NULL CONSTRAINT chk_workstation_alerts_kind CHECK (kind IN ('snapshot_signature_invalid', 'edge_db_recovered', 'key_version_mismatch', 'teardown_failed_stuck_resource')),
  detail JSONB DEFAULT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ws_alerts_ws ON workstation_alerts (workstation_id, occurred_at DESC);

CREATE TABLE admin_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_id UUID NOT NULL REFERENCES admin_accounts(id),
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(32) NOT NULL,
  entity_id UUID DEFAULT NULL,
  before JSONB DEFAULT NULL,
  after JSONB DEFAULT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_entity ON admin_audit_logs (entity_type, entity_id, occurred_at DESC);

CREATE FUNCTION fn_reject_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_reject_modification();

CREATE TRIGGER trg_admin_audit_append_only
  BEFORE UPDATE OR DELETE ON admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_reject_modification();

-- INV-007: an ended session is immutable, except one late real report replacing an inferred end (D-015).
CREATE FUNCTION fn_sessions_immutable_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on sessions is not allowed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'active'
     AND NOT (OLD.end_source = 'inferred' AND NEW.end_source = 'reported') THEN
    RAISE EXCEPTION 'session % already ended (end_source=%)', OLD.id, OLD.end_source
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_sessions_immutable_terminal
  BEFORE UPDATE OR DELETE ON sessions
  FOR EACH ROW EXECUTE FUNCTION fn_sessions_immutable_terminal();
