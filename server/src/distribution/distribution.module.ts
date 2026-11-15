import { Module } from '@nestjs/common';
import { OutboxWorker } from './outbox-worker';
import { SnapshotService } from './snapshot.service';
import { SyncService } from './sync.service';

// Distribution bounded context (03-domain): snapshots per workstation, their sync state and the reconnect protocol.
@Module({ providers: [SnapshotService, OutboxWorker, SyncService], exports: [SnapshotService, OutboxWorker, SyncService] })
export class DistributionModule {}
