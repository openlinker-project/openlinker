/**
 * Authentication Service
 *
 * Handles user credential validation and JWT token issuance. Depends on
 * UserRepositoryPort (via USER_REPOSITORY_TOKEN) to look up users and
 * bcryptjs to compare hashed passwords.
 *
 * @module apps/api/src/auth
 */
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { User } from '@openlinker/core/users';
import {
  EmailNotConfirmedException,
  UserRepositoryPort,
  USER_REPOSITORY_TOKEN,
} from '@openlinker/core/users';
import { LoginResponseDto } from './dto/login-response.dto';
import type { IAuthService } from './auth.service.interface';

@Injectable()
export class AuthService implements IAuthService {
  constructor(
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepositoryPort,
    private readonly jwtService: JwtService
  ) {}

  // Dummy hash used when user is not found to keep response time constant and
  // prevent user-enumeration via timing differences.
  private static readonly DUMMY_HASH =
    '$2b$10$AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  async validateUser(identifier: string, password: string): Promise<User | null> {
    // Accept either a username or an email as the identifier. The presence of
    // '@' disambiguates the two: usernames are forbidden from containing '@'
    // (enforced by RegisterDto), so an identifier with '@' is an email and one
    // without is a username. Branching this way makes the username<->email
    // collision impossible rather than merely unlikely, and collapses lookup to
    // a single query on every path.
    const user = identifier.includes('@')
      ? await this.userRepository.findByEmail(identifier)
      : await this.userRepository.findByUsername(identifier);
    if (!user) {
      await bcrypt.compare(password, AuthService.DUMMY_HASH);
      return null;
    }
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return null;
    }
    // The password matched, so the caller already knows this account exists —
    // telling them to check their inbox doesn't create a new enumeration
    // oracle. Give a clear, specific error for this one status.
    if (user.status === 'pending_confirmation') {
      throw new EmailNotConfirmedException();
    }
    // Other non-active users (pending admin approval/deactivated) get the
    // same 401 as wrong password to avoid account-status enumeration.
    if (user.status !== 'active') {
      return null;
    }
    return user;
  }

  login(user: User): LoginResponseDto {
    const payload = { sub: user.id, username: user.username, role: user.role };
    const dto = new LoginResponseDto();
    dto.access_token = this.jwtService.sign(payload);
    return dto;
  }

  async getMe(userId: string): Promise<User> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return user;
  }
}
