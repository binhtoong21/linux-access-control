import { Module } from '@nestjs/common';
import { ConfigModule } from './config';
import { DatabaseModule } from './infra/database/database.module';
import { SystemHealthController } from './operations/system-health.controller';

// One Nest module per bounded context (identity, device, scheduling, distribution, operations) is added per milestone.
@Module({ imports: [ConfigModule, DatabaseModule], controllers: [SystemHealthController] })
export class AppModule {}
