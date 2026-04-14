import type {
  ForgotPasswordRequest,
  LoginRequest,
  LoginResponse,
  OkResponse,
  ResetPasswordRequest,
} from './auth.types';

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface AuthApi {
  login: (input: LoginRequest) => Promise<LoginResponse>;
  forgotPassword: (input: ForgotPasswordRequest) => Promise<OkResponse>;
  resetPassword: (input: ResetPasswordRequest) => Promise<OkResponse>;
}

export function createAuthApi(request: ApiRequest): AuthApi {
  return {
    login(input): Promise<LoginResponse> {
      return request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    forgotPassword(input): Promise<OkResponse> {
      return request<OkResponse>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    resetPassword(input): Promise<OkResponse> {
      return request<OkResponse>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
  };
}
