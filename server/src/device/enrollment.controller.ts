import { Body, Controller, Get, Headers, HttpCode, Ip, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsMACAddress, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { MQTT_IDENTITY_PATTERN } from '../shared/crypto/pki';
import { AuthenticatedAdmin, CurrentAdmin, Public, SkipCsrf } from '../shared/http/auth.decorators';
import {
  BatchApproval,
  EnrollmentRequestStatus,
  EnrollmentRequestView,
  EnrollmentService,
  EnrollmentStatus,
  EnrollmentTicket,
} from './enrollment.service';

class EnrollDto {
  @Matches(/^[A-Za-z0-9-]{1,64}$/, { message: 'machine_id must match ^[A-Za-z0-9-]{1,64}$' })
  machine_id!: string;

  @IsString()
  @Matches(/\S/, { message: 'hostname must not be empty' })
  @MaxLength(255)
  hostname!: string;

  @IsMACAddress()
  mac_address!: string;

  @IsString()
  @MaxLength(8192)
  csr_pem!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  agent_version?: string;
}

class ApproveDto {
  // "reinstall" updates the workstation the request collides with and takes no other parameter.
  @IsIn(['new', 'reinstall'])
  mode!: 'new' | 'reinstall';

  @ValidateIf((dto: ApproveDto) => dto.mode !== 'reinstall')
  @Matches(MQTT_IDENTITY_PATTERN, { message: 'mqtt_identity must match ^[A-Za-z0-9_-]{3,64}$' })
  mqtt_identity?: string;

  // Absent or null: the workstation starts outside any zone.
  @IsOptional()
  @IsUUID()
  zone_id?: string | null;
}

class ApproveBatchDto {
  @IsUUID()
  zone_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  request_ids!: string[];

  // Two digits follow, so the result is always a valid mqtt identity.
  @Matches(/^[A-Za-z0-9_-]{1,60}$/, { message: 'name_prefix must match ^[A-Za-z0-9_-]{1,60}$' })
  name_prefix!: string;
}

class RejectDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class ListRequestsQuery {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: EnrollmentRequestStatus;
}

const bearer = (header: string | undefined): string | undefined => /^Bearer (\S+)$/.exec(header ?? '')?.[1];

// api.md §6: the agent has no admin session and no browser, so neither the session nor the CSRF header applies.
@Public()
@SkipCsrf()
@Controller('workstations/enroll')
export class EnrollmentAgentController {
  constructor(private readonly enrollment: EnrollmentService) {}

  @Post()
  submit(@Body() dto: EnrollDto, @Ip() ip: string): Promise<EnrollmentTicket> {
    return this.enrollment.submit(dto, ip);
  }

  @Get(':requestId/status')
  status(@Param('requestId') requestId: string, @Headers('authorization') authorization: string | undefined): Promise<EnrollmentStatus> {
    return this.enrollment.status(requestId, bearer(authorization));
  }
}

@Controller('enrollment-requests')
export class EnrollmentRequestsController {
  constructor(private readonly enrollment: EnrollmentService) {}

  @Get()
  list(@Query() query: ListRequestsQuery): Promise<EnrollmentRequestView[]> {
    return this.enrollment.list(query.status);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<EnrollmentRequestView> {
    if (dto.mode === 'reinstall') return this.enrollment.approveReinstall(id, actor.id);
    return this.enrollment.approveNew(id, dto.mqtt_identity as string, dto.zone_id ?? null, actor.id);
  }

  @Post('approve-batch')
  @HttpCode(200)
  approveBatch(@Body() dto: ApproveBatchDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<BatchApproval> {
    return this.enrollment.approveBatch(dto.zone_id, dto.request_ids, dto.name_prefix, actor.id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<EnrollmentRequestView> {
    return this.enrollment.reject(id, dto.note, actor.id);
  }
}
