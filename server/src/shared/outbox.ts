import { Kysely } from 'kysely';
import { Database } from '../infra/database/schema';

// Internal domain events (08-api/events.md §5). Written with the transaction of the change (XINV-005);
// the Distribution worker (M2.5) reads them and rebuilds the affected snapshots. Never put raw card UIDs in a payload.
export type IdentityEventType =
  | 'UserUpdated'
  | 'UserDeactivated'
  | 'UserActivated'
  | 'GroupMembershipChanged'
  | 'CardBound'
  | 'CardUnbound'
  | 'CardDisabled'
  | 'CardEnabled';

export interface DomainEvent {
  aggregateType: 'user' | 'group' | 'card';
  aggregateId: string;
  eventType: IdentityEventType;
  payload: Record<string, unknown>;
}

export async function emitEvent(db: Kysely<Database>, e: DomainEvent): Promise<void> {
  await db
    .insertInto('server_outbox')
    .values({
      aggregate_type: e.aggregateType,
      aggregate_id: e.aggregateId,
      event_type: e.eventType,
      payload: JSON.stringify(e.payload),
    })
    .execute();
}
