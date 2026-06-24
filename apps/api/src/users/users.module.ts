/**
 * Users API Module
 *
 * Provides user-management endpoints for admin operations. Registers
 * UserManagementService and UsersController. Imports UsersModule from core
 * to access UserRepositoryPort (via USER_REPOSITORY_TOKEN).
 *
 * @module apps/api/src/users
 */
import { Module } from '@nestjs/common';
import { UsersModule } from '@openlinker/core/users';
import { UserManagementService } from './user-management.service';
import { USER_MANAGEMENT_SERVICE_TOKEN } from './user-management.service.interface';
import { UsersController } from './http/users.controller';

@Module({
  imports: [UsersModule],
  controllers: [UsersController],
  providers: [
    UserManagementService,
    { provide: USER_MANAGEMENT_SERVICE_TOKEN, useExisting: UserManagementService },
  ],
})
export class UsersApiModule {}
