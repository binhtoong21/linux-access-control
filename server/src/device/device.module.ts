import { Module } from '@nestjs/common';
import { WorkstationsController } from './workstations.controller';
import { WorkstationsService } from './workstations.service';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';

// Device bounded context (03-domain): zones, workstations and their profiles; enrollment lands with a later milestone.
@Module({ controllers: [ZonesController, WorkstationsController], providers: [ZonesService, WorkstationsService] })
export class DeviceModule {}
