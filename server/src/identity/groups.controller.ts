import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AuthenticatedAdmin, CurrentAdmin } from '../shared/http/auth.decorators';
import { GroupsService, GroupView } from './groups.service';
import { UserView } from './users.service';

class CreateGroupDto {
  @IsString()
  @Matches(/\S/, { message: 'name must not be empty' })
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}

class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'name must not be empty' })
  @MaxLength(128)
  name?: string | null;

  // null clears the description; absent leaves it unchanged.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}

class AddMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  user_ids!: string[];
}

@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  list(): Promise<GroupView[]> {
    return this.groups.list();
  }

  @Post()
  create(@Body() dto: CreateGroupDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<GroupView> {
    return this.groups.create(dto.name, dto.description, actor.id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<GroupView> {
    return this.groups.update(id, { name: dto.name ?? undefined, description: dto.description }, actor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<void> {
    await this.groups.remove(id, actor.id);
  }

  @Get(':id/members')
  members(@Param('id', ParseUUIDPipe) id: string): Promise<UserView[]> {
    return this.groups.members(id);
  }

  @Put(':id/members')
  @HttpCode(200)
  addMembers(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMembersDto, @CurrentAdmin() actor: AuthenticatedAdmin): Promise<{ added: string[] }> {
    return this.groups.addMembers(id, dto.user_ids, actor.id);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentAdmin() actor: AuthenticatedAdmin,
  ): Promise<void> {
    await this.groups.removeMember(id, userId, actor.id);
  }
}
