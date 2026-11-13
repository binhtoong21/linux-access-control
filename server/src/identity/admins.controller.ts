import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { AuthenticatedAdmin, CurrentAdmin } from '../shared/http/auth.decorators';
import { AdminView } from './admin-accounts';
import { AdminsService } from './admins.service';

class CreateAdminDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  display_name!: string;

  // Length 10-128 is enforced by checkPassword (one rule for API and CLI).
  @IsString()
  password!: string;
}

class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  current_password!: string;

  @IsString()
  new_password!: string;
}

@Controller('admins')
export class AdminsController {
  constructor(private readonly admins: AdminsService) {}

  @Get()
  list(): Promise<AdminView[]> {
    return this.admins.list();
  }

  @Post()
  create(@Body() dto: CreateAdminDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<AdminView> {
    return this.admins.create({ username: dto.username, displayName: dto.display_name, password: dto.password }, actor.id);
  }

  @Post('me/password')
  @HttpCode(204)
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<void> {
    await this.admins.changeOwnPassword(actor.id, dto.current_password, dto.new_password);
  }

  @Post(':id/disable')
  @HttpCode(200)
  disable(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<AdminView> {
    return this.admins.setStatus(id, 'disabled', actor.id);
  }

  @Post(':id/enable')
  @HttpCode(200)
  enable(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<AdminView> {
    return this.admins.setStatus(id, 'active', actor.id);
  }
}
