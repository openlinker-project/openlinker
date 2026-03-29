export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
}

export type { MeResponse } from '../../../shared/auth/session.types';
