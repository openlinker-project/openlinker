/**
 * Demo Mode Service
 *
 * Reads OL_DEMO_MODE from the environment. When enabled, the registration
 * flow auto-approves new accounts (status: 'active') and the system config
 * endpoint surfaces the flag to the frontend.
 *
 * @module apps/api/src/auth
 * @implements {IDemoModeService}
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IDemoModeService } from './demo-mode.service.interface';

@Injectable()
export class DemoModeService implements IDemoModeService {
  constructor(private readonly configService: ConfigService) {}

  isDemoModeEnabled(): boolean {
    return (
      this.configService.get<string>('OL_DEMO_MODE', 'false').trim().toLowerCase() === 'true'
    );
  }
}
