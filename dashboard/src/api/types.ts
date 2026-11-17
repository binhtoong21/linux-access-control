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

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export type UserStatus = 'active' | 'inactive';

export interface User {
  id: string;
  external_id: string;
  full_name: string;
  email: string | null;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export type UserDetail = User & {
  cards: {
    id: string;
    status: 'active' | 'disabled' | 'unbound';
    uid_length: number;
    created_at: string;
  }[];
  groups: {
    id: string;
    name: string;
  }[];
};

export interface Group {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export type CardStatus = 'active' | 'disabled' | 'unbound';

export interface CardOwner {
  id: string;
  external_id: string;
  full_name: string;
}

export interface Card {
  id: string;
  status: CardStatus;
  uid_length: number;
  owner: CardOwner | null;
  created_at: string;
  updated_at: string;
}

export type CardDetail = Card & {
  uid: string;
};

