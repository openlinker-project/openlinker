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
import { RefreshTokenOrmEntity } from './infrastructure/persistence/entities/refresh-token.orm-entity';
import { RefreshTokenRepository } from './infrastructure/persistence/repositories/refresh-token.repository';
import { EmailConfirmationTokenOrmEntity } from './infrastructure/persistence/entities/email-confirmation-token.orm-entity';
import { EmailConfirmationTokenRepository } from './infrastructure/persistence/repositories/email-confirmation-token.repository';
import { McpTokenOrmEntity } from './infrastructure/persistence/entities/mcp-token.orm-entity';
import { McpTokenRepository } from './infrastructure/persistence/repositories/mcp-token.repository';
import { McpTokenService } from './application/services/mcp-token.service';
import {
  USER_REPOSITORY_TOKEN,
  PASSWORD_RESET_TOKEN_REPOSITORY_TOKEN,
  REFRESH_TOKEN_REPOSITORY_TOKEN,
  EMAIL_CONFIRMATION_TOKEN_REPOSITORY_TOKEN,
  MCP_TOKEN_REPOSITORY_TOKEN,
  MCP_TOKEN_SERVICE_TOKEN,
} from './users.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserOrmEntity,
      PasswordResetTokenOrmEntity,
      RefreshTokenOrmEntity,
      EmailConfirmationTokenOrmEntity,
      McpTokenOrmEntity,
    ]),
  ],
  providers: [
    UserRepository,
    { provide: USER_REPOSITORY_TOKEN, useExisting: UserRepository },
    PasswordResetTokenRepository,
    { provide: PASSWORD_RESET_TOKEN_REPOSITORY_TOKEN, useExisting: PasswordResetTokenRepository },
    RefreshTokenRepository,
    { provide: REFRESH_TOKEN_REPOSITORY_TOKEN, useExisting: RefreshTokenRepository },
    EmailConfirmationTokenRepository,
    {
      provide: EMAIL_CONFIRMATION_TOKEN_REPOSITORY_TOKEN,
      useExisting: EmailConfirmationTokenRepository,
    },
    McpTokenRepository,
    { provide: MCP_TOKEN_REPOSITORY_TOKEN, useExisting: McpTokenRepository },
    McpTokenService,
    { provide: MCP_TOKEN_SERVICE_TOKEN, useExisting: McpTokenService },
  ],
  exports: [
    USER_REPOSITORY_TOKEN,
    PASSWORD_RESET_TOKEN_REPOSITORY_TOKEN,
    REFRESH_TOKEN_REPOSITORY_TOKEN,
    EMAIL_CONFIRMATION_TOKEN_REPOSITORY_TOKEN,
    MCP_TOKEN_REPOSITORY_TOKEN,
    MCP_TOKEN_SERVICE_TOKEN,
  ],
})
export class UsersModule {}
