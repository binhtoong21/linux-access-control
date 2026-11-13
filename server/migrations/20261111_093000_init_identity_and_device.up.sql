-- Applied by src/infra/database/migrator.ts inside one transaction; do NOT add BEGIN/COMMIT here.

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id VARCHAR(64) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) DEFAULT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CONSTRAINT chk_users_status CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_users_nonempty CHECK (length(btrim(external_id)) > 0 AND length(btrim(full_name)) > 0)
);

CREATE UNIQUE INDEX uq_users_external_id ON users (btrim(external_id));

CREATE TABLE admin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(64) NOT NULL CONSTRAINT chk_admin_accounts_username CHECK (length(btrim(username)) > 0),
  display_name VARCHAR(255) NOT NULL CONSTRAINT chk_admin_accounts_display_name CHECK (length(btrim(display_name)) > 0),
  password_hash TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CONSTRAINT chk_admin_accounts_status CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_admin_username_ci ON admin_accounts (lower(btrim(username)));

CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid_encrypted BYTEA NOT NULL,
  uid_iv BYTEA NOT NULL CONSTRAINT chk_cards_uid_iv CHECK (octet_length(uid_iv) = 12),
  uid_auth_tag BYTEA NOT NULL CONSTRAINT chk_cards_uid_auth_tag CHECK (octet_length(uid_auth_tag) = 16),
  encryption_key_id VARCHAR(32) NOT NULL,
  uid_index CHAR(64) NOT NULL CONSTRAINT uq_cards_uid_index UNIQUE,
  uid_length SMALLINT NOT NULL CONSTRAINT chk_cards_uid_length CHECK (uid_length IN (4, 7, 10)),
  owner_id UUID DEFAULT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CONSTRAINT chk_cards_status CHECK (status IN ('unbound', 'active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cards_owner_unbound CHECK ((status = 'unbound' AND owner_id IS NULL) OR (status IN ('active', 'disabled') AND owner_id IS NOT NULL))
);

CREATE INDEX idx_cards_owner ON cards (owner_id) WHERE owner_id IS NOT NULL;

CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL CONSTRAINT chk_groups_name CHECK (length(btrim(name)) > 0),
  description TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_groups_name_ci ON groups (lower(btrim(name)));

CREATE TABLE group_members (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_members_user ON group_members (user_id);

CREATE TABLE zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL,
  location VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_zones_name_ci ON zones (lower(btrim(name)));

CREATE TABLE workstations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mqtt_identity VARCHAR(64) NOT NULL CONSTRAINT uq_workstations_mqtt_identity UNIQUE,
  machine_id VARCHAR(64) NOT NULL CONSTRAINT uq_workstations_machine_id UNIQUE,
  mac_address MACADDR NOT NULL CONSTRAINT uq_workstations_mac_address UNIQUE,
  hostname VARCHAR(255) NOT NULL,
  public_key TEXT NOT NULL,
  cert_serial VARCHAR(64) DEFAULT NULL,
  cert_expires_at TIMESTAMPTZ DEFAULT NULL,
  key_version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_workstations_key_version CHECK (key_version >= 1),
  zone_id UUID DEFAULT NULL REFERENCES zones(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'enrolled' CONSTRAINT chk_workstations_status CHECK (status IN ('enrolled', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ws_zone ON workstations (zone_id);

CREATE TABLE workstation_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workstation_id UUID NOT NULL REFERENCES workstations(id) ON DELETE CASCADE,
  os_username VARCHAR(32) NOT NULL CONSTRAINT chk_workstation_profiles_os_username CHECK (os_username ~ '^[a-z_][a-z0-9_-]{0,31}$'),
  display_name VARCHAR(128) NOT NULL,
  profile_type VARCHAR(16) NOT NULL DEFAULT 'shared' CONSTRAINT chk_workstation_profiles_profile_type CHECK (profile_type IN ('shared')),
  is_default BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(16) NOT NULL DEFAULT 'enabled' CONSTRAINT chk_workstation_profiles_status CHECK (status IN ('enabled', 'disabled')),
  description TEXT DEFAULT NULL,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_workstation_profiles_ws_user UNIQUE (workstation_id, os_username)
);

CREATE UNIQUE INDEX uq_ws_default_profile ON workstation_profiles (workstation_id) WHERE is_default = true;

CREATE TABLE enrollment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fetch_code_hash CHAR(64) NOT NULL,
  fetch_code_invalidated_at TIMESTAMPTZ DEFAULT NULL,
  machine_id VARCHAR(64) NOT NULL,
  mac_address MACADDR NOT NULL,
  hostname VARCHAR(255) NOT NULL,
  csr_pem TEXT NOT NULL,
  public_key TEXT NOT NULL,
  duplicate_mac_detected BOOLEAN NOT NULL DEFAULT false,
  duplicate_of_workstation_id UUID DEFAULT NULL REFERENCES workstations(id) ON DELETE SET NULL,
  workstation_id UUID DEFAULT NULL REFERENCES workstations(id) ON DELETE SET NULL,
  assigned_zone_id UUID DEFAULT NULL REFERENCES zones(id) ON DELETE SET NULL,
  issued_cert_pem TEXT DEFAULT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CONSTRAINT chk_enrollment_requests_status CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  reviewed_by UUID DEFAULT NULL REFERENCES admin_accounts(id),
  CONSTRAINT chk_enrollment_requests_review CHECK ((status = 'pending' AND reviewed_at IS NULL) OR (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL)),
  CONSTRAINT chk_enrollment_requests_duplicate CHECK (status <> 'approved' OR duplicate_of_workstation_id IS NULL OR workstation_id = duplicate_of_workstation_id)
);

CREATE INDEX idx_enroll_req_status_mac ON enrollment_requests (status, mac_address);
CREATE INDEX idx_enroll_req_status_machine ON enrollment_requests (status, machine_id);

CREATE TABLE revoked_certificates (
  cert_serial VARCHAR(64) PRIMARY KEY,
  workstation_id UUID NOT NULL REFERENCES workstations(id),
  reason VARCHAR(16) NOT NULL CONSTRAINT chk_revoked_certificates_reason CHECK (reason IN ('reinstalled', 'disabled')),
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
