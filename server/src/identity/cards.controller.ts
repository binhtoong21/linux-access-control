import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { CardStatus } from '../infra/database/schema';
import { AuthenticatedAdmin, CurrentAdmin } from '../shared/http/auth.decorators';
import { Page, PageQueryDto } from '../shared/http/pagination';
import { CardDetail, CardsService, CardView } from './cards.service';

class ListCardsQuery extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  uid?: string;

  @IsOptional()
  @IsUUID()
  user_id?: string;

  @IsOptional()
  @IsIn(['unbound', 'active', 'disabled'])
  status?: CardStatus;
}

// Exactly one of uid / from_audit_entry_id; checked by CardsService so the error names the field.
class RegisterCardDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  uid?: string;

  @IsOptional()
  @IsUUID()
  from_audit_entry_id?: string;

  @IsUUID()
  user_id!: string;
}

class BindCardDto {
  @IsUUID()
  user_id!: string;
}

@Controller('cards')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Get()
  list(@Query() query: ListCardsQuery): Promise<Page<CardView>> {
    return this.cards.list({ uid: query.uid, userId: query.user_id, status: query.status, limit: query.limit, cursor: query.cursor });
  }

  /** 201 for a new card, 200 when an existing unbound card is bound again or already belongs to the user. */
  @Post()
  async register(
    @Body() dto: RegisterCardDto,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CardView> {
    const { card, created } = await this.cards.register(
      { uid: dto.uid ?? undefined, fromAuditEntryId: dto.from_audit_entry_id ?? undefined, userId: dto.user_id },
      actor.id,
    );
    res.status(created ? 201 : 200);
    return card;
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CardDetail> {
    return this.cards.get(id);
  }

  @Post(':id/disable')
  @HttpCode(200)
  disable(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<CardView> {
    return this.cards.setEnabled(id, false, actor.id);
  }

  @Post(':id/enable')
  @HttpCode(200)
  enable(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<CardView> {
    return this.cards.setEnabled(id, true, actor.id);
  }

  @Post(':id/unbind')
  @HttpCode(200)
  unbind(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<CardView> {
    return this.cards.unbind(id, actor.id);
  }

  @Post(':id/bind')
  @HttpCode(200)
  bind(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BindCardDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<CardView> {
    return this.cards.bind(id, dto.user_id, actor.id);
  }
}
