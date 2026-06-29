export type UserStatus = 'pending' | 'active' | 'deactivated';
export type UserRole = 'admin' | 'viewer';

export interface UserSummary {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

export interface UserListResponse {
  users: UserSummary[];
  total: number;
}

export interface UserListFilters {
  status?: UserStatus;
  page?: number;
  pageSize?: number;
}

export interface ApproveUserInput {
  role: UserRole;
}
