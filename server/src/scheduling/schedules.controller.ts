import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDefined, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { ScheduleStatus } from '../infra/database/schema';
import { AuthenticatedAdmin, CurrentAdmin } from '../shared/http/auth.decorators';
import { DATE_PATTERN, DAYS, OS_USERNAME_PATTERN, SchedulesService, ScheduleValidation, ScheduleView, TIME_PATTERN } from './schedules.service';

const DATE_MESSAGE = { message: '$property must be a date YYYY-MM-DD' };
const TIME_MESSAGE = { message: '$property must be HH:MM between 00:00 and 24:00' };
const OS_USERNAME_MESSAGE = { message: 'target_os_username must match ^[a-z_][a-z0-9_-]{0,31}$' };

class SubjectDto {
  @IsIn(['user', 'group'])
  type!: 'user' | 'group';

  @IsUUID()
  id!: string;
}

class TargetDto {
  @IsIn(['workstation', 'zone'])
  type!: 'workstation' | 'zone';

  @IsUUID()
  id!: string;
}

class CreateScheduleDto {
  @IsString()
  @Matches(/\S/, { message: 'name must not be empty' })
  @MaxLength(255)
  name!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => SubjectDto)
  subject!: SubjectDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => TargetDto)
  target!: TargetDto;

  @Matches(DATE_PATTERN, DATE_MESSAGE)
  @IsISO8601({ strict: true })
  valid_from!: string;

  @IsOptional()
  @Matches(DATE_PATTERN, DATE_MESSAGE)
  @IsISO8601({ strict: true })
  valid_to?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(DAYS, { each: true })
  days_of_week!: string[];

  @Matches(TIME_PATTERN, TIME_MESSAGE)
  start_time!: string;

  @Matches(TIME_PATTERN, TIME_MESSAGE)
  end_time!: string;

  @IsOptional()
  @Matches(OS_USERNAME_PATTERN, OS_USERNAME_MESSAGE)
  target_os_username?: string | null;
}

class ValidateScheduleDto extends CreateScheduleDto {
  // The schedule being edited, so that it is not compared with itself; absent when validating a new schedule.
  @IsOptional()
  @IsUUID()
  schedule_id?: string | null;
}

class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'name must not be empty' })
  @MaxLength(255)
  name?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => SubjectDto)
  subject?: SubjectDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => TargetDto)
  target?: TargetDto | null;

  @IsOptional()
  @Matches(DATE_PATTERN, DATE_MESSAGE)
  @IsISO8601({ strict: true })
  valid_from?: string | null;

  // null clears the end date; absent leaves it unchanged.
  @IsOptional()
  @Matches(DATE_PATTERN, DATE_MESSAGE)
  @IsISO8601({ strict: true })
  valid_to?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(DAYS, { each: true })
  days_of_week?: string[] | null;

  @IsOptional()
  @Matches(TIME_PATTERN, TIME_MESSAGE)
  start_time?: string | null;

  @IsOptional()
  @Matches(TIME_PATTERN, TIME_MESSAGE)
  end_time?: string | null;

  // null falls back to the workstation's default profile; absent leaves it unchanged.
  @IsOptional()
  @Matches(OS_USERNAME_PATTERN, OS_USERNAME_MESSAGE)
  target_os_username?: string | null;
}

class ListSchedulesQuery {
  @IsOptional()
  @IsUUID()
  workstation_id?: string;

  @IsOptional()
  @IsUUID()
  zone_id?: string;

  @IsOptional()
  @IsUUID()
  group_id?: string;

  @IsOptional()
  @IsUUID()
  user_id?: string;

  @IsOptional()
  @IsIn(['enabled', 'disabled'])
  status?: ScheduleStatus;
}

@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  list(@Query() query: ListSchedulesQuery): Promise<ScheduleView[]> {
    return this.schedules.list({
      workstationId: query.workstation_id,
      zoneId: query.zone_id,
      groupId: query.group_id,
      userId: query.user_id,
      status: query.status,
    });
  }

  @Post()
  create(@Body() dto: CreateScheduleDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<ScheduleView> {
    return this.schedules.create(dto, actor.id);
  }

  @Post('validate')
  @HttpCode(200)
  validate(@Body() dto: ValidateScheduleDto): Promise<ScheduleValidation> {
    const { schedule_id, ...input } = dto;
    return this.schedules.validate(input, schedule_id ?? undefined);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ScheduleView> {
    return this.schedules.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateScheduleDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<ScheduleView> {
    return this.schedules.update(
      id,
      {
        name: dto.name ?? undefined,
        subject: dto.subject ?? undefined,
        target: dto.target ?? undefined,
        valid_from: dto.valid_from ?? undefined,
        valid_to: dto.valid_to,
        days_of_week: dto.days_of_week ?? undefined,
        start_time: dto.start_time ?? undefined,
        end_time: dto.end_time ?? undefined,
        target_os_username: dto.target_os_username,
      },
      actor.id,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<void> {
    await this.schedules.remove(id, actor.id);
  }

  @Post(':id/enable')
  @HttpCode(200)
  enable(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<ScheduleView> {
    return this.schedules.setStatus(id, 'enabled', actor.id);
  }

  @Post(':id/disable')
  @HttpCode(200)
  disable(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<ScheduleView> {
    return this.schedules.setStatus(id, 'disabled', actor.id);
  }
}
