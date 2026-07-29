/**
 * ConnectionResponseDto — secret redaction unit tests (#1124, #1616)
 *
 * Verifies that the role-aware static factory never leaks raw config values
 * to non-admin callers (deny-by-default, not late-blanking), and that the
 * demo-mode-aware relaxation (#1616) only widens visibility for the
 * read-only 'viewer' role while a deployment is in demo mode — a production
 * 'operator', or any role outside demo mode, still gets a blanked config.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ConnectionResponseDto } from './connection-response.dto';
import type { Connection } from '@openlinker/core/identifier-mapping';

const baseConnection: Connection = {
  id: 'conn-uuid-001',
  platformType: 'prestashop',
  name: 'Test Store',
  status: 'active',
  config: { baseUrl: 'https://shop.example.com', apiKey: 'secret-key-123' },
  credentialsRef: 'db:conn-uuid-001',
  adapterKey: 'prestashop.webservice.v1',
  enabledCapabilities: ['ProductMaster'],
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

const supportedCapabilities = ['ProductMaster', 'InventoryMaster'];

describe('ConnectionResponseDto.fromDomain', () => {
  describe('config redaction', () => {
    it('should return full config for admin role', () => {
      const dto = ConnectionResponseDto.fromDomain(baseConnection, supportedCapabilities, 'admin');
      expect(dto.config).toEqual({ baseUrl: 'https://shop.example.com', apiKey: 'secret-key-123' });
    });

    it('should return empty config for viewer role outside demo mode', () => {
      const dto = ConnectionResponseDto.fromDomain(baseConnection, supportedCapabilities, 'viewer');
      expect(dto.config).toEqual({});
    });

    it('should return empty config for viewer role when demo mode is explicitly disabled', () => {
      const dto = ConnectionResponseDto.fromDomain(
        baseConnection,
        supportedCapabilities,
        'viewer',
        false
      );
      expect(dto.config).toEqual({});
    });

    it('should return real config for viewer role when demo mode is enabled (#1616)', () => {
      const dto = ConnectionResponseDto.fromDomain(
        baseConnection,
        supportedCapabilities,
        'viewer',
        true
      );
      expect(dto.config).toEqual({
        baseUrl: 'https://shop.example.com',
        apiKey: 'secret-key-123',
      });
    });

    it('should still blank config for operator role even when demo mode is enabled (#1124 protection preserved)', () => {
      const dto = ConnectionResponseDto.fromDomain(
        baseConnection,
        supportedCapabilities,
        'operator',
        true
      );
      expect(dto.config).toEqual({});
    });

    it('should return full config for admin role regardless of demo mode flag', () => {
      const dto = ConnectionResponseDto.fromDomain(
        baseConnection,
        supportedCapabilities,
        'admin',
        false
      );
      expect(dto.config).toEqual({
        baseUrl: 'https://shop.example.com',
        apiKey: 'secret-key-123',
      });
    });

    it('should return empty config when role is undefined (no secret reaches unauthenticated callers)', () => {
      const dto = ConnectionResponseDto.fromDomain(baseConnection, supportedCapabilities, undefined);
      expect(dto.config).toEqual({});
    });

    it('should return {} not null or undefined for non-admin — preserves FE Record<string,unknown> contract', () => {
      const dto = ConnectionResponseDto.fromDomain(baseConnection, supportedCapabilities, 'viewer');
      expect(dto.config).not.toBeNull();
      expect(dto.config).not.toBeUndefined();
      expect(typeof dto.config).toBe('object');
    });

    it('should never include secret field values in viewer response even when config has many keys', () => {
      const connection: Connection = {
        ...baseConnection,
        config: {
          apiKey: 'top-secret',
          webhookSecret: 'also-secret',
          baseUrl: 'https://shop.example.com',
          oauthClientId: 'client-id',
        },
      };
      const dto = ConnectionResponseDto.fromDomain(connection, supportedCapabilities, 'viewer');
      expect(Object.keys(dto.config)).toHaveLength(0);
    });
  });

  describe('non-sensitive fields', () => {
    it('should always project id, platformType, name, status regardless of role', () => {
      for (const role of ['admin', 'viewer', undefined] as const) {
        const dto = ConnectionResponseDto.fromDomain(baseConnection, supportedCapabilities, role);
        expect(dto.id).toBe('conn-uuid-001');
        expect(dto.platformType).toBe('prestashop');
        expect(dto.name).toBe('Test Store');
        expect(dto.status).toBe('active');
      }
    });

    it('should always project supportedCapabilities regardless of role', () => {
      for (const role of ['admin', 'viewer', undefined] as const) {
        const dto = ConnectionResponseDto.fromDomain(baseConnection, supportedCapabilities, role);
        expect(dto.supportedCapabilities).toEqual(['ProductMaster', 'InventoryMaster']);
      }
    });

    it('should derive credentialsBacked from credentialsRef prefix', () => {
      const dto = ConnectionResponseDto.fromDomain(baseConnection, supportedCapabilities, 'viewer');
      expect(dto.credentialsBacked).toBe(true);

      const envBacked: Connection = { ...baseConnection, credentialsRef: 'env:PRESTASHOP_KEY' };
      const dto2 = ConnectionResponseDto.fromDomain(envBacked, supportedCapabilities, 'viewer');
      expect(dto2.credentialsBacked).toBe(false);
    });
  });
});
