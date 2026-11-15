import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { ProfileStatus } from '../infra/database/schema';
import { AppError } from '../shared/http/app-error';
import { AuthenticatedAdmin, CurrentAdmin } from '../shared/http/auth.decorators';
import {
  Connectivity,
  PROFILE_NAME_PATTERN,
  ProfileView,
  SyncState,
  WorkstationDetail,
  WorkstationsService,
  WorkstationStatus,
  WorkstationSummary,
} from './workstations.service';

class ListWorkstationsQuery {
  @IsOptional()
  @IsUUID()
  zone_id?: string;

  @IsOptional()
  @IsIn(['enrolled', 'disabled'])
  status?: WorkstationStatus;

  @IsOptional()
  @IsIn(['online', 'offline'])
  connectivity?: Connectivity;

  @IsOptional()
  @IsIn(['in_sync', 'pending', 'stuck'])
  sync?: SyncState;
}

class UpdateWorkstationDto {
  // null takes the workstation out of its zone; absent leaves it unchanged.
  @IsOptional()
  @IsUUID()
  zone_id?: string | null;
}

class UpdateProfileDto {
  @IsOptional()
  @IsIn(['enabled', 'disabled'])
  status?: ProfileStatus | null;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean | null;
}

@Controller('workstations')
export class WorkstationsController {
  constructor(private readonly workstations: WorkstationsService) {}

  @Get()
  list(@Query() query: ListWorkstationsQuery): Promise<WorkstationSummary[]> {
    return this.workstations.list({ zoneId: query.zone_id, status: query.status, connectivity: query.connectivity, sync: query.sync });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<WorkstationDetail> {
    return this.workstations.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkstationDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<WorkstationDetail> {
    if (dto.zone_id === undefined) return this.workstations.get(id);
    return this.workstations.setZone(id, dto.zone_id, actor.id);
  }

  @Get(':id/profiles')
  profiles(@Param('id', ParseUUIDPipe) id: string): Promise<ProfileView[]> {
    return this.workstations.profiles(id);
  }

  @Patch(':id/profiles/:osUsername')
  updateProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('osUsername') osUsername: string,
    @Body() dto: UpdateProfileDto,
    @CurrentAdmin() actor: AuthenticatedAdmin,
  ): Promise<ProfileView> {
    if (!PROFILE_NAME_PATTERN.test(osUsername)) throw new AppError('NOT_FOUND', 'Profile not found');
    return this.workstations.updateProfile(id, osUsername, { status: dto.status ?? undefined, is_default: dto.is_default ?? undefined }, actor.id);
  }
}
