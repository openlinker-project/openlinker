import type {
  ConfirmEmailRequest,
  ForgotPasswordRequest,
  LoginRequest,
  LoginResponse,
  MeResponse,
  OkResponse,
  RegisterRequest,
  ResetPasswordRequest,
  UpdateAnalyticsConsentRequest,
} from './auth.types';

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface AuthApi {
  login: (input: LoginRequest) => Promise<LoginResponse>;
  register: (input: RegisterRequest) => Promise<OkResponse>;
  forgotPassword: (input: ForgotPasswordRequest) => Promise<OkResponse>;
  resetPassword: (input: ResetPasswordRequest) => Promise<OkResponse>;
  confirmEmail: (input: ConfirmEmailRequest) => Promise<OkResponse>;
  updateAnalyticsConsent: (input: UpdateAnalyticsConsentRequest) => Promise<MeResponse>;
}

export function createAuthApi(request: ApiRequest): AuthApi {
  return {
    login(input): Promise<LoginResponse> {
      return request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    register(input): Promise<OkResponse> {
      return request<OkResponse>('/auth/register', {
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
    confirmEmail(input): Promise<OkResponse> {
      return request<OkResponse>('/auth/confirm-email', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    updateAnalyticsConsent(input): Promise<MeResponse> {
      return request<MeResponse>('/auth/me/analytics-consent', {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    },
  };
}
