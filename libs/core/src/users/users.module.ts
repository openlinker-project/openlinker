/**
 * Users Module
 *
 * NestJS module for user persistence. Registers the UserRepository and
 * PasswordResetTokenRepository, exporting their port tokens so auth can
 * inject them without depending on concrete classes.
 *
 * @module libs/core/src/users
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserOrmEntity } from './infrastructure/persistence/entities/user.orm-entity';
import { UserRepository } from './infrastructure/persistence/repositories/user.repository';
import { PasswordResetTokenOrmEntity } from './infrastructure/persistence/entities/password-reset-token.orm-entity';
import { PasswordResetTokenRepository } from './infrastructure/persistence/repositories/password-reset-token.repository';
import {
  USER_REPOSITORY_TOKEN,
  PASSWORD_RESET_TOKEN_REPOSITORY_TOKEN,
} from './users.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([UserOrmEntity, PasswordResetTokenOrmEntity])],
  providers: [
    UserRepository,
    { provide: USER_REPOSITORY_TOKEN, useExisting: UserRepository },
    PasswordResetTokenRepository,
    { provide: PASSWORD_RESET_TOKEN_REPOSITORY_TOKEN, useExisting: PasswordResetTokenRepository },
  ],
  exports: [USER_REPOSITORY_TOKEN, PASSWORD_RESET_TOKEN_REPOSITORY_TOKEN],
})
export class UsersModule {}
