/**
 * Registration Service
 *
 * Implements self-service user registration. Creates users in `pending` status
 * so they cannot log in until an admin approves them and assigns a role.
 *
 * Controlled by OL_REGISTRATION_ENABLED env flag (default false). When
 * disabled, all registration attempts are rejected with a 403.
 *
 * @module apps/api/src/auth
 * @implements {IRegistrationService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Logger } from '@openlinker/shared/logging';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared/cache';
import {
  RegistrationDisabledException,
  RegistrationRateLimitedException,
  UserAlreadyExistsException,
  UserRepositoryPort,
  USER_REPOSITORY_TOKEN,
} from '@openlinker/core/users';
import type { IRegistrationService } from './registration.service.interface';
import { DEMO_MODE_SERVICE_TOKEN, type IDemoModeService } from './demo-mode.service.interface';

const BCRYPT_COST = 10;

@Injectable()
export class RegistrationService implements IRegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepositoryPort,
    private readonly configService: ConfigService,
    @Inject(DEMO_MODE_SERVICE_TOKEN)
    private readonly demoModeService: IDemoModeService,
    @Inject(CACHE_PORT_TOKEN)
    private readonly cache: CachePort,
  ) {}

  async register(
    username: string,
    email: string,
    password: string,
    clientIp?: string,
  ): Promise<void> {
    const enabled = this.configService.get<string>('OL_REGISTRATION_ENABLED', 'false');
    if (enabled.trim().toLowerCase() !== 'true') {
      throw new RegistrationDisabledException();
    }

    const demoMode = this.demoModeService.isDemoModeEnabled();
    if (demoMode && clientIp) {
      await this.enforceRateLimit(clientIp);
    }

    const [existingByUsername, existingByEmail] = await Promise.all([
      this.userRepository.findByUsername(username),
      this.userRepository.findByEmail(email),
    ]);

    if (existingByUsername) {
      throw new UserAlreadyExistsException(username);
    }
    if (existingByEmail) {
      throw new UserAlreadyExistsException(email);
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await this.userRepository.save({
      username,
      email,
      passwordHash,
      role: 'viewer',
      // Demo mode: activate immediately so the user can log in right away.
      // Normal mode: pending admin approval per the #1125 approval flow.
      status: demoMode ? 'active' : 'pending',
    });

    if (demoMode) {
      this.logger.log(`Demo account registered and auto-activated: ${username}`);
    } else {
      this.logger.log(`New user registered and pending approval: ${username}`);
    }
  }

  /**
   * Fixed-window counter keyed by client IP (#1469). Best-effort, not
   * atomic — `CachePort` exposes only get/set/delete, so a race between two
   * concurrent requests from the same IP can both read the pre-increment
   * count. Acceptable here: this is abuse deterrence for a public demo, not
   * a hard security boundary.
   */
  private async enforceRateLimit(clientIp: string): Promise<void> {
    const limit = Number(
      this.configService.get<string>('OL_DEMO_REGISTRATION_RATE_LIMIT', '5'),
    );
    const windowSeconds = Number(
      this.configService.get<string>('OL_DEMO_REGISTRATION_RATE_WINDOW_SECONDS', '3600'),
    );
    const key = `demo:register:${clientIp}`;
    const count = (await this.cache.get<number>(key)) ?? 0;
    if (count >= limit) {
      this.logger.warn(`Registration rate limit exceeded for IP ${clientIp}`);
      throw new RegistrationRateLimitedException();
    }
    await this.cache.set(key, count + 1, windowSeconds);
  }
}
