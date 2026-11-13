-- Dev/test only: never run on a database with real audit data (migrations.md 1.1).
DROP TABLE IF EXISTS admin_audit_logs CASCADE;
DROP TABLE IF EXISTS workstation_alerts CASCADE;
DROP TABLE IF EXISTS ingest_rejects CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS workstation_statuses CASCADE;
DROP FUNCTION IF EXISTS fn_sessions_immutable_terminal();
DROP FUNCTION IF EXISTS fn_reject_modification();
