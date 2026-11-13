-- Applied by src/infra/database/migrator.ts inside one transaction; do NOT add BEGIN/COMMIT here.

CREATE TABLE schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL CONSTRAINT chk_schedules_name CHECK (length(btrim(name)) > 0),
  subject_type VARCHAR(16) NOT NULL CONSTRAINT chk_schedules_subject_type CHECK (subject_type IN ('user', 'group')),
  subject_user_id UUID DEFAULT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subject_group_id UUID DEFAULT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  target_type VARCHAR(16) NOT NULL CONSTRAINT chk_schedules_target_type CHECK (target_type IN ('workstation', 'zone')),
  target_workstation_id UUID DEFAULT NULL REFERENCES workstations(id) ON DELETE RESTRICT,
  target_zone_id UUID DEFAULT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  valid_from DATE NOT NULL,
  valid_to DATE DEFAULT NULL,
  days_of_week TEXT[] NOT NULL,
  start_minute SMALLINT NOT NULL,
  end_minute SMALLINT NOT NULL,
  target_os_username VARCHAR(32) DEFAULT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'enabled' CONSTRAINT chk_schedules_status CHECK (status IN ('enabled', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_sched_subject_xor CHECK ((subject_type = 'user' AND subject_user_id IS NOT NULL AND subject_group_id IS NULL) OR (subject_type = 'group' AND subject_group_id IS NOT NULL AND subject_user_id IS NULL)),
  CONSTRAINT chk_sched_target_xor CHECK ((target_type = 'workstation' AND target_workstation_id IS NOT NULL AND target_zone_id IS NULL) OR (target_type = 'zone' AND target_zone_id IS NOT NULL AND target_workstation_id IS NULL)),
  CONSTRAINT chk_sched_recurrence CHECK ((valid_to IS NULL OR valid_from <= valid_to) AND cardinality(days_of_week) >= 1 AND days_of_week <@ ARRAY['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY']::TEXT[] AND start_minute >= 0 AND start_minute < end_minute AND end_minute <= 1440)
);

CREATE INDEX idx_sched_target_ws ON schedules (target_workstation_id) WHERE target_workstation_id IS NOT NULL;
CREATE INDEX idx_sched_target_zone ON schedules (target_zone_id) WHERE target_zone_id IS NOT NULL;
CREATE INDEX idx_sched_subject_user ON schedules (subject_user_id) WHERE subject_user_id IS NOT NULL;
CREATE INDEX idx_sched_subject_group ON schedules (subject_group_id) WHERE subject_group_id IS NOT NULL;

CREATE TABLE snapshots (
  workstation_id UUID NOT NULL REFERENCES workstations(id) ON DELETE CASCADE,
  version BIGINT NOT NULL CONSTRAINT chk_snapshots_version CHECK (version >= 1),
  key_version INTEGER NOT NULL,
  content_hash CHAR(64) NOT NULL,
  payload_raw BYTEA NOT NULL,
  hmac_signature CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workstation_id, version)
);

CREATE TABLE sync_states (
  workstation_id UUID PRIMARY KEY REFERENCES workstations(id) ON DELETE CASCADE,
  desired_version BIGINT NOT NULL DEFAULT 0,
  acked_version BIGINT NOT NULL DEFAULT 0 CONSTRAINT chk_sync_states_acked_version CHECK (acked_version >= 0),
  desired_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acked_at TIMESTAMPTZ DEFAULT NULL
);

CREATE TABLE server_outbox (
  id BIGSERIAL PRIMARY KEY,
  aggregate_type VARCHAR(32) NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CONSTRAINT chk_server_outbox_status CHECK (status IN ('pending', 'processed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX idx_server_outbox_pending ON server_outbox (id) WHERE status = 'pending';
