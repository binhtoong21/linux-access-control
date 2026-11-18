import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthenticatedAdmin, CurrentAdmin } from '../shared/http/auth.decorators';
import { ImportResult, RosterImportService } from './roster-import.service';

export class RosterImportDto {
  @IsString()
  @MaxLength(1_000_000)
  csv!: string;

  @IsOptional()
  @IsBoolean()
  apply?: boolean;
}

@Controller('imports')
export class ImportsController {
  constructor(private readonly rosterImport: RosterImportService) {}

  @Post('roster')
  @HttpCode(200)
  run(@Body() dto: RosterImportDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<ImportResult> {
    return this.rosterImport.run(dto.csv, dto.apply ?? false, actor.id);
  }
}
