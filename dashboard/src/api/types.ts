export interface Admin {
  id: string;
  username: string;
  display_name: string;
}

export type WorkstationFlag =
  | 'overdue_session'
  | 'stuck_sync'
  | 'apply_error'
  | 'missing_profile'
  | 'ingest_rejects'
  | 'security_alert';

export interface WorkstationSummary {
  id: string;
  mqtt_identity: string;
  hostname: string;
  zone: { id: string; name: string } | null;
  status: string;
  connectivity: 'online' | 'offline';
  last_heartbeat_at: string | null;
  trust_state: string | null;
  clock_skew_detected: boolean;
  sync: {
    state: 'in_sync' | 'pending' | 'stuck';
    desired_version: number;
    acked_version: number;
  };
  current_session: {
    user: {
      external_id: string;
      full_name: string;
    };
    started_at: string;
    expires_at: string;
  } | null;
  flags: WorkstationFlag[];
}
