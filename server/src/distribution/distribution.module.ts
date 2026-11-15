import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { MqttGateway } from './mqtt-gateway';
import { OutboxWorker } from './outbox-worker';
import { SnapshotService } from './snapshot.service';
import { SyncService } from './sync.service';

// Distribution bounded context (03-domain): snapshots per workstation, their sync state, the reconnect protocol and the broker link.
@Module({
  imports: [OperationsModule],
  providers: [SnapshotService, OutboxWorker, SyncService, MqttGateway],
  exports: [SnapshotService, OutboxWorker, SyncService, MqttGateway],
})
export class DistributionModule {}
