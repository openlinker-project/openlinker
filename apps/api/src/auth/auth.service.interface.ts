/**
 * Authentication Service Interface
 *
 * Contract for user credential validation and JWT token issuance.
 *
 * @module apps/api/src/auth
 */
import type { User } from '@openlinker/core/users';
import type { LoginResponseDto } from './dto/login-response.dto';

export const AUTH_SERVICE_TOKEN = Symbol('IAuthService');

export interface IAuthService {
  validateUser(username: string, password: string): Promise<User | null>;
  login(user: User): LoginResponseDto;
  getMe(userId: string): Promise<User>;
}
