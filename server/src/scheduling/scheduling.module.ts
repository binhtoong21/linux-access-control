import { Module } from '@nestjs/common';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

// Scheduling bounded context (03-domain): who may use which workstation or zone, and when.
@Module({ controllers: [SchedulesController], providers: [SchedulesService] })
export class SchedulingModule {}
