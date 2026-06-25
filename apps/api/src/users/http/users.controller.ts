/**
 * Users Controller
 *
 * Admin-only HTTP REST API endpoints for user management. All write endpoints
 * carry @Roles('admin') individually so the write-guard-coverage invariant
 * can detect regressions per method.
 *
 * GET    /users                — list all users (optional ?status filter)
 * POST   /users/:id/approve    — approve a pending registration with a role
 * POST   /users/:id/reject     — reject and delete a pending registration
 * PATCH  /users/:id/role       — change a user's role
 * POST   /users/:id/deactivate — deactivate an active user
 * POST   /users/:id/reactivate — reactivate a deactivated user
 * DELETE /users/:id            — permanently delete a user
 *
 * @module apps/api/src/users/http
 */
import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CannotSelfModifyException,
  LastAdminException,
  UserNotFoundException,
  UserNotActiveException,
  UserNotDeactivatedException,
  UserNotPendingException,
} from '@openlinker/core/users';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ApproveUserDto } from '../dto/approve-user.dto';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
import { UpdateRoleDto } from '../dto/update-role.dto';
import { UserListResponseDto } from '../dto/user-list-response.dto';
import { IUserManagementService, USER_MANAGEMENT_SERVICE_TOKEN } from '../user-management.service.interface';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    @Inject(USER_MANAGEMENT_SERVICE_TOKEN)
    private readonly userManagement: IUserManagementService
  ) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'List all users (admin only)' })
  @ApiResponse({ status: 200, description: 'User list', type: UserListResponseDto })
  async listUsers(@Query() query: ListUsersQueryDto): Promise<UserListResponseDto> {
    const result = await this.userManagement.listUsers({
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return UserListResponseDto.fromDomain(result);
  }

  @Post(':id/approve')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Approve a pending registration and assign a role (admin only)' })
  @ApiResponse({ status: 204, description: 'User approved' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User is not in pending status' })
  async approveUser(@Param('id') id: string, @Body() dto: ApproveUserDto): Promise<void> {
    try {
      await this.userManagement.approveUser(id, dto.role);
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof UserNotPendingException) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Post(':id/reject')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reject and delete a pending registration (admin only)' })
  @ApiResponse({ status: 204, description: 'Pending user rejected and removed' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User is not in pending status' })
  async rejectUser(@Param('id') id: string): Promise<void> {
    try {
      await this.userManagement.rejectUser(id);
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof UserNotPendingException) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Patch(':id/role')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Change a user's role (admin only)" })
  @ApiResponse({ status: 204, description: 'Role updated' })
  @ApiResponse({ status: 403, description: 'Cannot modify own account or last admin' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: AuthenticatedUser
  ): Promise<void> {
    try {
      await this.userManagement.updateRole(id, dto.role, actor.id);
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof CannotSelfModifyException || error instanceof LastAdminException) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  @Post(':id/deactivate')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a user — they can no longer log in (admin only)' })
  @ApiResponse({ status: 204, description: 'User deactivated' })
  @ApiResponse({ status: 403, description: 'Cannot deactivate own account or last admin' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User is not active' })
  async deactivateUser(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser
  ): Promise<void> {
    try {
      await this.userManagement.deactivateUser(id, actor.id);
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof CannotSelfModifyException || error instanceof LastAdminException) {
        throw new ForbiddenException(error.message);
      }
      if (error instanceof UserNotActiveException) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Post(':id/reactivate')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reactivate a deactivated user (admin only)' })
  @ApiResponse({ status: 204, description: 'User reactivated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User is not deactivated' })
  async reactivateUser(@Param('id') id: string): Promise<void> {
    try {
      await this.userManagement.reactivateUser(id);
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof UserNotDeactivatedException) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Permanently delete a user (admin only)' })
  @ApiResponse({ status: 204, description: 'User deleted' })
  @ApiResponse({ status: 403, description: 'Cannot delete own account or last admin' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deleteUser(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser
  ): Promise<void> {
    try {
      await this.userManagement.deleteUser(id, actor.id);
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof CannotSelfModifyException || error instanceof LastAdminException) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }
}
