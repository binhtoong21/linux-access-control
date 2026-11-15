import { Module } from '@nestjs/common';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';

// Device bounded context (03-domain): zones now; workstations, profiles and enrollment land with later milestones.
@Module({ controllers: [ZonesController], providers: [ZonesService] })
export class DeviceModule {}
