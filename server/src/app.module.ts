import { Module } from '@nestjs/common';
import { ConfigModule } from './config';
import { DeviceModule } from './device/device.module';
import { DistributionModule } from './distribution/distribution.module';
import { IdentityModule } from './identity/identity.module';
import { DatabaseModule } from './infra/database/database.module';
import { KeysModule } from './infra/keys.module';
import { OperationsModule } from './operations/operations.module';
import { SystemHealthController } from './operations/system-health.controller';
import { SchedulingModule } from './scheduling/scheduling.module';

// One Nest module per bounded context (identity, device, scheduling, distribution, operations) is added per milestone.
@Module({
  imports: [ConfigModule, DatabaseModule, KeysModule, IdentityModule, DeviceModule, SchedulingModule, DistributionModule, OperationsModule],
  controllers: [SystemHealthController],
})
export class AppModule {}
