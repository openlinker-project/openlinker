export interface MeResponse {
  id: string;
  username: string;
  email: string | null;
}

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  roles: string[];
}

export interface Session {
  status: 'anonymous' | 'authenticated';
  accessToken: string | null;
  user: SessionUser | null;
}

export const ANONYMOUS_SESSION: Session = {
  status: 'anonymous',
  accessToken: null,
  user: null,
};
