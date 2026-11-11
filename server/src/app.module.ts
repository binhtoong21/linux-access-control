import { Module } from '@nestjs/common';
import { SystemHealthController } from './operations/system-health.controller';

// One Nest module per bounded context (identity, device, scheduling, distribution, operations) is added per milestone.
@Module({ controllers: [SystemHealthController] })
export class AppModule {}
