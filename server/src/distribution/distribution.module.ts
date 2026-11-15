import { Module } from '@nestjs/common';
import { OutboxWorker } from './outbox-worker';
import { SnapshotService } from './snapshot.service';

// Distribution bounded context (03-domain): snapshots per workstation and their sync state; MQTT publishing comes later.
@Module({ providers: [SnapshotService, OutboxWorker], exports: [SnapshotService, OutboxWorker] })
export class DistributionModule {}
