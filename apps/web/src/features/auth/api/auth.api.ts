import type { LoginRequest, LoginResponse } from './auth.types';

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface AuthApi {
  login: (input: LoginRequest) => Promise<LoginResponse>;
}

export function createAuthApi(request: ApiRequest): AuthApi {
  return {
    login(input): Promise<LoginResponse> {
      return request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
  };
}
