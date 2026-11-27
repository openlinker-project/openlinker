/**
 * Login Page Settings API Module
 *
 * @module apps/api/src/login-page-settings
 */
import { Module } from '@nestjs/common';
import { LoginPageSettingsModule as CoreLoginPageSettingsModule } from '@openlinker/core/login-page-settings';
import { LoginPageSettingsController } from './http/login-page-settings.controller';

@Module({
  imports: [CoreLoginPageSettingsModule],
  controllers: [LoginPageSettingsController],
})
export class LoginPageSettingsApiModule {}
