export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  /** Opt-in for demo-only usage analytics, chosen on the register form (#1743). */
  analyticsConsent: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface ConfirmEmailRequest {
  token: string;
}

export interface OkResponse {
  ok: true;
}

export type { MeResponse } from '../../../shared/auth/session.types';
