/**
 * Users API Module
 *
 * Provides user-management endpoints for admin operations. Registers
 * UserManagementService and UsersController. Imports UsersModule from core
 * to access UserRepositoryPort (via USER_REPOSITORY_TOKEN). Exports
 * USER_MANAGEMENT_SERVICE_TOKEN so AuthModule can reuse the
 * `pending_confirmation → active` status transition for email confirmation
 * (#1624).
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
  // USER_MANAGEMENT_SERVICE_TOKEN is exported so AuthModule's
  // EmailConfirmationService can reuse the `pending_confirmation → active`
  // status transition (#1624) instead of duplicating status-guard logic.
  exports: [USER_MANAGEMENT_SERVICE_TOKEN],
})
export class UsersApiModule {}
