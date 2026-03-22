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
import { User, UserRepositoryPort, USER_REPOSITORY_TOKEN } from '@openlinker/core/users';
import { LoginResponseDto } from './dto/login-response.dto';

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepositoryPort,
    private readonly jwtService: JwtService,
  ) {}

  // Dummy hash used when user is not found to keep response time constant and
  // prevent user-enumeration via timing differences.
  private static readonly DUMMY_HASH =
    '$2b$10$AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  async validateUser(username: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findByUsername(username);
    if (!user) {
      await bcrypt.compare(password, AuthService.DUMMY_HASH);
      return null;
    }
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    return isMatch ? user : null;
  }

  login(user: User): LoginResponseDto {
    const payload = { sub: user.id, username: user.username };
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
