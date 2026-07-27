import type {
  BankAccount,
  Connection,
  ConnectionDiagnostics,
  ConnectionFilters,
  ConnectionTestResult,
  CreateConnectionInput,
  InstallWebhooksResult,
  RotateWebhookSecretResult,
  SubiektBankAccount,
  SubiektCashRegister,
  UpdateConnectionInput,
  WebhookStatus,
} from './connections.types';

export interface ConnectionsApi {
  create: (input: CreateConnectionInput) => Promise<Connection>;
  disable: (connectionId: string) => Promise<Connection>;
  getBankAccounts: (connectionId: string) => Promise<BankAccount[]>;
  getSubiektBankAccounts: (connectionId: string) => Promise<SubiektBankAccount[]>;
  getSubiektCashRegisters: (connectionId: string) => Promise<SubiektCashRegister[]>;
  getDiagnostics: (connectionId: string) => Promise<ConnectionDiagnostics>;
  getById: (connectionId: string) => Promise<Connection>;
  installWebhooks: (connectionId: string) => Promise<InstallWebhooksResult>;
  rotateWebhookSecret: (connectionId: string) => Promise<RotateWebhookSecretResult>;
  setWebhookSecret: (connectionId: string, secret: string) => Promise<void>;
  getWebhookStatus: (connectionId: string) => Promise<WebhookStatus>;
  list: (filters?: ConnectionFilters) => Promise<Connection[]>;
  setDefaultBankAccount: (connectionId: string, accountId: string) => Promise<void>;
  test: (connectionId: string) => Promise<ConnectionTestResult>;
  update: (connectionId: string, input: UpdateConnectionInput) => Promise<Connection>;
  updateCredentials: (
    connectionId: string,
    credentials: Record<string, unknown>,
  ) => Promise<void>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: ConnectionFilters): string {
  const params = new URLSearchParams();

  if (filters?.platformType) {
    params.set('platformType', filters.platformType);
  }

  if (filters?.status) {
    params.set('status', filters.status);
  }

  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

export function createConnectionsApi(request: ApiRequest): ConnectionsApi {
  return {
    create(input): Promise<Connection> {
      return request<Connection>('/connections', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    disable(connectionId): Promise<Connection> {
      return request<Connection>(`/connections/${connectionId}/disable`, {
        method: 'PATCH',
      });
    },
    getBankAccounts(connectionId): Promise<BankAccount[]> {
      return request<BankAccount[]>(`/connections/${connectionId}/bank-accounts`);
    },
    getSubiektBankAccounts(connectionId): Promise<SubiektBankAccount[]> {
      return request<SubiektBankAccount[]>(
        `/integrations/subiekt/connections/${connectionId}/bank-accounts`,
      );
    },
    getSubiektCashRegisters(connectionId): Promise<SubiektCashRegister[]> {
      return request<SubiektCashRegister[]>(
        `/integrations/subiekt/connections/${connectionId}/cash-registers`,
      );
    },
    setDefaultBankAccount(connectionId, accountId): Promise<void> {
      return request<void>(`/connections/${connectionId}/bank-accounts/${accountId}/default`, {
        method: 'POST',
      });
    },
    getDiagnostics(connectionId): Promise<ConnectionDiagnostics> {
      return request<ConnectionDiagnostics>(`/connections/${connectionId}/diagnostics`);
    },
    getById(connectionId): Promise<Connection> {
      return request<Connection>(`/connections/${connectionId}`);
    },
    installWebhooks(connectionId): Promise<InstallWebhooksResult> {
      return request<InstallWebhooksResult>(`/connections/${connectionId}/webhooks/install`, {
        method: 'POST',
      });
    },
    rotateWebhookSecret(connectionId): Promise<RotateWebhookSecretResult> {
      return request<RotateWebhookSecretResult>(
        `/connections/${connectionId}/webhooks/secret/rotate`,
        { method: 'POST' },
      );
    },
    setWebhookSecret(connectionId, secret): Promise<void> {
      return request<void>(`/connections/${connectionId}/webhooks/secret`, {
        method: 'PUT',
        body: JSON.stringify({ secret }),
      });
    },
    getWebhookStatus(connectionId): Promise<WebhookStatus> {
      return request<WebhookStatus>(`/connections/${connectionId}/webhooks/status`);
    },
    list(filters): Promise<Connection[]> {
      return request<Connection[]>(`/connections${buildQuery(filters)}`);
    },
    test(connectionId): Promise<ConnectionTestResult> {
      return request<ConnectionTestResult>(`/connections/${connectionId}/test`, {
        method: 'POST',
      });
    },
    update(connectionId, input): Promise<Connection> {
      return request<Connection>(`/connections/${connectionId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    },
    updateCredentials(connectionId, credentials): Promise<void> {
      return request<void>(`/connections/${connectionId}/credentials`, {
        method: 'PUT',
        body: JSON.stringify({ credentials }),
      });
    },
  };
}
