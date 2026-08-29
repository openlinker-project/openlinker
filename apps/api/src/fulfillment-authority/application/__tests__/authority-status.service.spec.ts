/**
 * Authority status service (#2353)
 *
 * @module apps/api/src/fulfillment-authority/application/__tests__
 */
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IOrderRecordService } from '@openlinker/core/orders';
import type { IConnectionService } from '../../../integrations/application/interfaces/connection.service.interface';
import { AuthorityStatusService } from '../services/authority-status.service';

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    platformType: 'prestashop',
    name: 'Shop',
    status: 'active',
    config: {},
    credentialsRef: 'ref',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    adapterKey: undefined,
    enabledCapabilities: [],
    ...overrides,
  } as unknown as Connection;
}

describe('AuthorityStatusService', () => {
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'resolveAdapterMetadata'>>;
  let connectionService: jest.Mocked<Pick<IConnectionService, 'list' | 'update'>>;
  let orderRecordService: jest.Mocked<Pick<IOrderRecordService, 'countOrdersWithOmsAttention'>>;
  let service: AuthorityStatusService;

  beforeEach(() => {
    integrationsService = {
      resolveAdapterMetadata: jest.fn().mockResolvedValue({ supportedCapabilities: [] }),
    };
    connectionService = {
      list: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(connection()),
    };
    orderRecordService = { countOrdersWithOmsAttention: jest.fn().mockResolvedValue(0) };
    service = new AuthorityStatusService(
      connectionService as unknown as IConnectionService,
      integrationsService as unknown as IIntegrationsService,
      orderRecordService as unknown as IOrderRecordService
    );
  });

  describe('getStatus', () => {
    it('should answer all seven questions with a why on a zero-config install', async () => {
      const status = await service.getStatus();

      expect(status.rows).toHaveLength(7);
      for (const row of status.rows) {
        expect(row.answer).toBeDefined();
        expect(row.why).toBeDefined();
      }
    });

    it('should count nothing as attention-worthy when every row is a default', async () => {
      // Spec §4.3 / #2356's A2-`none` regression: the correct answer to a
      // question that does not arise must never put a red number on the page.
      const status = await service.getStatus();

      expect(status.attention.counted).toEqual([]);
      expect(status.attention.affectedOrderCount).toBe(0);
    });

    it('should report the routine array as present and empty, never absent', async () => {
      const status = await service.getStatus();

      expect(status.attention.routine).toEqual([]);
    });

    it('should return every preset including the unavailable ones, each with a reason', async () => {
      const status = await service.getStatus();

      expect(status.presets.map((preset) => preset.id)).toEqual([
        'leave-as-they-are',
        'openlinker-decides',
        'keep-other-system',
      ]);
      expect(status.presets[2]).toEqual({
        id: 'keep-other-system',
        available: false,
        unavailableReason: 'needs-a-system-that-can-take-over',
      });
    });

    it('should surface the persisted order count alongside the derived states', async () => {
      orderRecordService.countOrdersWithOmsAttention.mockResolvedValue(4);

      const status = await service.getStatus();

      expect(status.attention.affectedOrderCount).toBe(4);
    });

    it('should derive an inert state from an ambiguous row, naming both connections', async () => {
      connectionService.list.mockResolvedValue([
        connection({ id: 'conn-a', config: { sourcingAuthority: true } as never }),
        connection({ id: 'conn-b', config: { sourcingAuthority: true } as never }),
      ]);

      const status = await service.getStatus();

      expect(status.attention.counted).toHaveLength(1);
      expect(status.attention.counted[0]).toMatchObject({
        reason: 'sourcing-ambiguous',
        question: 'sourcing',
        badge: 'stopped',
      });
      expect([...status.attention.counted[0].connectionIds].sort()).toEqual(['conn-a', 'conn-b']);
    });

    it('should report an inactive claimant without letting it hold or contest anything', async () => {
      // `analytics-trust`'s trap: an active-only read hides exactly the
      // connection whose lingering claim the operator is trying to understand.
      connectionService.list.mockResolvedValue([
        connection({ id: 'conn-a', config: { sourcingAuthority: true } as never }),
        connection({
          id: 'conn-off',
          status: 'disabled',
          config: { sourcingAuthority: true } as never,
        }),
      ]);

      const status = await service.getStatus();
      const sourcing = status.rows.find((row) => row.question === 'sourcing');

      expect(sourcing?.state).toBe('resolved');
      expect(sourcing?.inactiveClaimantConnectionIds).toEqual(['conn-off']);
      expect(status.attention.counted).toEqual([]);
    });

    it('should degrade a connection whose adapter metadata cannot be resolved, not drop it', async () => {
      // A `config-only` authority never consults the capability list, so dropping
      // the connection would silently lose an A2 claim.
      integrationsService.resolveAdapterMetadata.mockRejectedValue(new Error('no adapter'));
      connectionService.list.mockResolvedValue([
        connection({ id: 'conn-a', config: { sourcingAuthority: true } as never }),
      ]);

      const status = await service.getStatus();
      const sourcing = status.rows.find((row) => row.question === 'sourcing');

      expect(sourcing?.state).toBe('resolved');
    });
  });

  describe('previewPreset', () => {
    it('should report no changes for the preset that changes nothing', async () => {
      connectionService.list.mockResolvedValue([
        connection({ config: { availabilityAuthority: true } as never }),
      ]);

      const preview = await service.previewPreset('leave-as-they-are');

      expect(preview.changes).toEqual([]);
      expect(preview.blocked).toBe(false);
    });

    it('should report exactly the rows a preset changes', async () => {
      connectionService.list.mockResolvedValue([
        connection({ config: { sourcingAuthority: true } as never }),
      ]);

      const preview = await service.previewPreset('openlinker-decides');

      expect(preview.changes.map((change) => change.question)).toEqual(['sourcing']);
      expect(preview.changes[0].before.state).toBe('resolved');
      expect(preview.changes[0].after.state).toBe('default');
    });

    it('should write nothing', async () => {
      connectionService.list.mockResolvedValue([
        connection({ config: { sourcingAuthority: true } as never }),
      ]);

      await service.previewPreset('openlinker-decides');

      expect(connectionService.update).not.toHaveBeenCalled();
    });

    it('should report a pre-existing ambiguity that the preset does not clear', async () => {
      connectionService.list.mockResolvedValue([
        connection({ id: 'conn-a', config: { sourcingAuthority: true } as never }),
        connection({ id: 'conn-b', config: { sourcingAuthority: true } as never }),
      ]);

      const preview = await service.previewPreset('leave-as-they-are');

      expect(preview.blocked).toBe(true);
      expect([...preview.resultingAmbiguities[0].connectionIds].sort()).toEqual(['conn-a', 'conn-b']);
    });

    it('should refuse an unavailable preset rather than previewing a fiction', async () => {
      await expect(service.previewPreset('keep-other-system')).rejects.toBeInstanceOf(
        BadRequestException
      );
    });
  });

  describe('applyPreset', () => {
    it('should write only the connections whose config actually changed', async () => {
      connectionService.list.mockResolvedValue([
        connection({ id: 'conn-claim', config: { sourcingAuthority: true } as never }),
        connection({ id: 'conn-plain', config: { stockSafetyBuffer: 2 } as never }),
      ]);

      await service.applyPreset('openlinker-decides');

      expect(connectionService.update).toHaveBeenCalledTimes(1);
      expect(connectionService.update).toHaveBeenCalledWith('conn-claim', {
        config: { sourcingAuthority: { enabled: false } },
      });
    });

    it('should write nothing at all for the no-op preset', async () => {
      connectionService.list.mockResolvedValue([
        connection({ config: { sourcingAuthority: true } as never }),
      ]);

      await service.applyPreset('leave-as-they-are');

      expect(connectionService.update).not.toHaveBeenCalled();
    });

    it('should refuse with 422 and write nothing when the result would be ambiguous', async () => {
      // Reachable without a preset that assigns: an install that is ALREADY
      // ambiguous is refused by every preset, which is story S1-4.
      connectionService.list.mockResolvedValue([
        connection({
          id: 'conn-a',
          enabledCapabilities: ['ReturnsAuthority'],
          config: { returnsAuthority: true } as never,
        }),
        connection({
          id: 'conn-b',
          enabledCapabilities: ['ReturnsAuthority'],
          config: { returnsAuthority: true } as never,
        }),
      ]);

      await expect(service.applyPreset('leave-as-they-are')).rejects.toBeInstanceOf(
        UnprocessableEntityException
      );
      expect(connectionService.update).not.toHaveBeenCalled();
    });

    it('should name the conflicting connections in the refusal', async () => {
      connectionService.list.mockResolvedValue([
        connection({ id: 'conn-a', config: { sourcingAuthority: true } as never }),
        connection({ id: 'conn-b', config: { sourcingAuthority: true } as never }),
      ]);

      await expect(service.applyPreset('leave-as-they-are')).rejects.toMatchObject({
        response: {
          ambiguities: [expect.objectContaining({ reason: 'sourcing-ambiguous' })],
        },
      });
    });

    it('should refuse an unavailable preset without reading connections', async () => {
      await expect(service.applyPreset('keep-other-system')).rejects.toBeInstanceOf(
        BadRequestException
      );
      expect(connectionService.list).not.toHaveBeenCalled();
    });

    it('should report which connections it wrote', async () => {
      connectionService.list.mockResolvedValue([
        connection({ id: 'conn-claim', config: { sourcingAuthority: true } as never }),
        connection({ id: 'conn-plain', config: { stockSafetyBuffer: 2 } as never }),
      ]);

      const status = await service.applyPreset('openlinker-decides');

      expect(status.applied).toEqual({
        updatedConnectionIds: ['conn-claim'],
        failedConnectionIds: [],
      });
    });

    it('should keep applying and report the failure when one connection write fails', async () => {
      // N independent full-row saves cannot be atomic here, so a mid-loop throw
      // would leave the install part-changed AND unreported — the operator would
      // get a 500 with no way to tell which connections moved.
      connectionService.list.mockResolvedValue([
        connection({ id: 'conn-a', config: { sourcingAuthority: true } as never }),
        connection({
          id: 'conn-b',
          enabledCapabilities: ['ReturnsAuthority'],
          config: { returnsAuthority: true } as never,
        }),
      ]);
      connectionService.update.mockImplementation((id: string) =>
        id === 'conn-a' ? Promise.reject(new Error('validator said no')) : Promise.resolve(connection())
      );

      const status = await service.applyPreset('openlinker-decides');

      expect(connectionService.update).toHaveBeenCalledTimes(2);
      expect(status.applied).toEqual({
        updatedConnectionIds: ['conn-b'],
        failedConnectionIds: ['conn-a'],
      });
    });

    it('should not report an applied section on a plain status read', async () => {
      const status = await service.getStatus();

      expect(status.applied).toBeUndefined();
    });

    it('should return the resulting status after applying', async () => {
      connectionService.list.mockResolvedValue([
        connection({ config: { sourcingAuthority: true } as never }),
      ]);

      const status = await service.applyPreset('openlinker-decides');

      expect(status.rows).toHaveLength(7);
    });
  });
});
