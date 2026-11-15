import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AuthenticatedAdmin, CurrentAdmin } from '../shared/http/auth.decorators';
import { ZonesService, ZoneView } from './zones.service';

class CreateZoneDto {
  @IsString()
  @Matches(/\S/, { message: 'name must not be empty' })
  @MaxLength(128)
  name!: string;

  @IsString()
  @Matches(/\S/, { message: 'location must not be empty' })
  @MaxLength(255)
  location!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}

class UpdateZoneDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'name must not be empty' })
  @MaxLength(128)
  name?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'location must not be empty' })
  @MaxLength(255)
  location?: string | null;

  // null clears the description; absent leaves it unchanged.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}

@Controller('zones')
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Get()
  list(): Promise<ZoneView[]> {
    return this.zones.list();
  }

  @Post()
  create(@Body() dto: CreateZoneDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<ZoneView> {
    return this.zones.create(dto.name, dto.location, dto.description, actor.id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateZoneDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<ZoneView> {
    return this.zones.update(id, { name: dto.name ?? undefined, location: dto.location ?? undefined, description: dto.description }, actor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<void> {
    await this.zones.remove(id, actor.id);
  }
}
