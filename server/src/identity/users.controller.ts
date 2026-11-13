import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { UserStatus } from '../infra/database/schema';
import { AuthenticatedAdmin, CurrentAdmin } from '../shared/http/auth.decorators';
import { Page, PageQueryDto } from '../shared/http/pagination';
import { EXTERNAL_ID_PATTERN, UserDetail, UsersService, UserView } from './users.service';

class ListUsersQuery extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: UserStatus;

  @IsOptional()
  @IsUUID()
  group_id?: string;
}

class CreateUserDto {
  @IsString()
  @Matches(EXTERNAL_ID_PATTERN, { message: 'external_id must match ^[A-Za-z0-9._-]{1,32}$' })
  external_id!: string;

  @IsString()
  @Matches(/\S/, { message: 'full_name must not be empty' })
  @MaxLength(255)
  full_name!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string | null;
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'full_name must not be empty' })
  @MaxLength(255)
  full_name?: string | null;

  // null clears the email; absent leaves it unchanged.
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string | null;
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() query: ListUsersQuery): Promise<Page<UserView>> {
    return this.users.list({ q: query.q, status: query.status, groupId: query.group_id, limit: query.limit, cursor: query.cursor });
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<UserView> {
    return this.users.create({ externalId: dto.external_id, fullName: dto.full_name, email: dto.email ?? null }, actor.id);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<UserDetail> {
    return this.users.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<UserView> {
    return this.users.update(id, { fullName: dto.full_name ?? undefined, email: dto.email }, actor.id);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<UserView> {
    return this.users.setStatus(id, 'inactive', actor.id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<UserView> {
    return this.users.setStatus(id, 'active', actor.id);
  }
}
