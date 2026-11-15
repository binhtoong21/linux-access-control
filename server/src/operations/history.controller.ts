import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AuthenticatedAdmin, CurrentAdmin } from '../shared/http/auth.decorators';
import { Page, PageQueryDto } from '../shared/http/pagination';
import { AuditLogDetail, AuditLogView, HistoryService } from './history.service';

class RangeQuery extends PageQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

class AuditLogsQuery extends RangeQuery {
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @IsOptional()
  @IsUUID()
  workstation_id?: string;

  @IsOptional()
  @IsUUID()
  zone_id?: string;

  @IsOptional()
  @IsIn(['granted', 'denied', 'error', 'noop'])
  outcome?: string;

  @IsOptional()
  @Matches(/^[a-z_]{1,32}$/, { message: 'reason must be a reason code' })
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  card_uid?: string;
}

class SessionsQuery extends RangeQuery {
  @IsOptional()
  @IsUUID()
  workstation_id?: string;

  @IsOptional()
  @IsUUID()
  user_id?: string;

  @IsOptional()
  @IsIn(['active', 'completed', 'forced_logout', 'abandoned'])
  status?: string;
}

class RejectsQuery extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  workstation_id?: string;

  @IsOptional()
  @IsIn(['true', 'false', 'all'])
  resolved?: 'true' | 'false' | 'all';
}

class AlertsQuery extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  workstation_id?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;
}

class AdminAuditQuery extends RangeQuery {
  @IsOptional()
  @IsUUID()
  admin_id?: string;

  @IsOptional()
  @Matches(/^[a-z_]{1,32}$/, { message: 'entity_type must be an entity type' })
  entity_type?: string;

  @IsOptional()
  @IsUUID()
  entity_id?: string;
}

class ResolveDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

const page = (q: PageQueryDto) => ({ limit: q.limit, cursor: q.cursor });

@Controller()
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get('audit-logs')
  auditLogs(@Query() q: AuditLogsQuery): Promise<Page<AuditLogView>> {
    return this.history.auditLogs({
      ...page(q),
      from: q.from,
      to: q.to,
      userId: q.user_id,
      workstationId: q.workstation_id,
      zoneId: q.zone_id,
      outcome: q.outcome,
      reason: q.reason,
      cardUid: q.card_uid,
    });
  }

  @Get('audit-logs/:id')
  auditLog(@Param('id', ParseUUIDPipe) id: string): Promise<AuditLogDetail> {
    return this.history.auditLog(id);
  }

  @Get('sessions')
  sessions(@Query() q: SessionsQuery): Promise<Page<unknown>> {
    return this.history.sessions({ ...page(q), from: q.from, to: q.to, workstationId: q.workstation_id, userId: q.user_id, status: q.status });
  }

  @Get('ingest-rejects')
  ingestRejects(@Query() q: RejectsQuery): Promise<Page<unknown>> {
    return this.history.ingestRejects({ ...page(q), workstationId: q.workstation_id, resolved: q.resolved });
  }

  @Post('ingest-rejects/:id/resolve')
  @HttpCode(200)
  resolve(@Param('id') id: string, @Body() dto: ResolveDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<unknown> {
    return this.history.resolveReject(id, dto.note, actor.id);
  }

  @Get('workstation-alerts')
  alerts(@Query() q: AlertsQuery): Promise<Page<unknown>> {
    return this.history.alerts({ ...page(q), workstationId: q.workstation_id, from: q.from });
  }

  @Get('admin-audit-logs')
  adminAuditLogs(@Query() q: AdminAuditQuery): Promise<Page<unknown>> {
    return this.history.adminAuditLogs({
      ...page(q),
      from: q.from,
      to: q.to,
      adminId: q.admin_id,
      entityType: q.entity_type,
      entityId: q.entity_id,
    });
  }
}
