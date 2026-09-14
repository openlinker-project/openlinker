/**
 * Connection Pricing & Sync Controller — unit tests (#3146, ADR-072; #3163 review)
 *
 * A thin pass-through, so what's worth pinning is exactly that: the response
 * is a proper `ConnectionPricingSyncResponseDto` (never the raw domain view)
 * built via `.fromDomain`, the update route threads `default` /
 * `sourceOverrides` (defaulted to `{}` when absent) / `expectedUpdatedAt`
 * through unchanged, and the `as-source` route projects every entry.
 *
 * @module apps/api/src/integrations/http
 */
import { ConnectionPricingSyncController } from './connection-pricing-sync.controller';
import type { IConnectionPricingSyncService } from '../application/interfaces/connection-pricing-sync.service.interface';
import {
  ConnectionAsSourceEntryResponseDto,
  ConnectionPricingSyncResponseDto,
} from './dto/connection-pricing-sync-response.dto';
import type { UpdatePricingSyncDto } from './dto/update-pricing-sync.dto';

describe('ConnectionPricingSyncController', () => {
  let pricingSync: jest.Mocked<IConnectionPricingSyncService>;
  let controller: ConnectionPricingSyncController;

  beforeEach(() => {
    pricingSync = {
      getPricingSync: jest.fn(),
      updatePricingSync: jest.fn(),
      getAsSource: jest.fn(),
    };
    controller = new ConnectionPricingSyncController(pricingSync);
  });

  describe('get', () => {
    it('projects the domain view into a ConnectionPricingSyncResponseDto', async () => {
      pricingSync.getPricingSync.mockResolvedValue({
        default: { mode: 'manual', rule: null },
        sources: [
          {
            sourceConnectionId: 'src-1',
            sourceLabel: 'PrestaShop — Main Store',
            modeOverridden: false,
            ruleOverridden: true,
            effective: { mode: 'manual', rule: { type: 'markup', percent: 15, rounding: 'none' } },
            openEpisodeCount: 2,
          },
        ],
      });

      const dto = await controller.get('dest-1');

      expect(pricingSync.getPricingSync).toHaveBeenCalledWith('dest-1');
      expect(dto).toBeInstanceOf(ConnectionPricingSyncResponseDto);
      expect(dto.default).toEqual({ mode: 'manual', rule: null });
      expect(dto.sources).toHaveLength(1);
      expect(dto.sources[0]).toEqual(
        expect.objectContaining({
          sourceConnectionId: 'src-1',
          sourceLabel: 'PrestaShop — Main Store',
          modeOverridden: false,
          ruleOverridden: true,
          openEpisodeCount: 2,
          effective: { mode: 'manual', rule: { type: 'markup', percent: 15, rounding: 'none' } },
        })
      );
    });
  });

  describe('update', () => {
    it('defaults an absent sourceOverrides to {} and threads expectedUpdatedAt through', async () => {
      pricingSync.updatePricingSync.mockResolvedValue({
        default: { mode: 'automatic', rule: null },
        sources: [],
      });
      const body = {
        default: { mode: 'automatic', rule: null },
        expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
      } as unknown as UpdatePricingSyncDto;

      const dto = await controller.update('dest-1', body);

      expect(pricingSync.updatePricingSync).toHaveBeenCalledWith('dest-1', {
        default: { mode: 'automatic', rule: null },
        sourceOverrides: {},
        expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(dto).toBeInstanceOf(ConnectionPricingSyncResponseDto);
    });

    it('passes a supplied sourceOverrides map through unchanged', async () => {
      pricingSync.updatePricingSync.mockResolvedValue({
        default: { mode: 'manual', rule: null },
        sources: [],
      });
      const body = {
        default: { mode: 'manual', rule: null },
        sourceOverrides: { 'src-1': { mode: 'automatic' } },
      } as unknown as UpdatePricingSyncDto;

      await controller.update('dest-1', body);

      expect(pricingSync.updatePricingSync).toHaveBeenCalledWith(
        'dest-1',
        expect.objectContaining({ sourceOverrides: { 'src-1': { mode: 'automatic' } } })
      );
    });
  });

  describe('asSource', () => {
    it('projects every rollup entry into a ConnectionAsSourceEntryResponseDto', async () => {
      pricingSync.getAsSource.mockResolvedValue([
        {
          destinationConnectionId: 'dest-1',
          destinationLabel: 'Allegro — PL',
          effectiveMode: 'manual',
          effectiveRuleSummary: null,
          modeOverridden: false,
          ruleOverridden: false,
        },
      ]);

      const dtos = await controller.asSource('src-1');

      expect(pricingSync.getAsSource).toHaveBeenCalledWith('src-1');
      expect(dtos).toHaveLength(1);
      expect(dtos[0]).toBeInstanceOf(ConnectionAsSourceEntryResponseDto);
      expect(dtos[0]).toEqual(
        expect.objectContaining({ destinationConnectionId: 'dest-1', effectiveMode: 'manual' })
      );
    });
  });
});
