/**
 * Authority preset catalogue (#2353)
 *
 * @module apps/api/src/fulfillment-authority/application/__tests__
 */
import {
  AUTHORITY_PRESETS,
  AuthorityPresetIdValues,
  isAuthorityPresetId,
} from '../authority-presets';
import { parseAuthorityConfig } from '@openlinker/core/fulfillment-authority';
import type { ConnectionConfig } from '@openlinker/core/identifier-mapping';

const config = (value: Record<string, unknown>): ConnectionConfig =>
  value as unknown as ConnectionConfig;

describe('AUTHORITY_PRESETS', () => {
  it('should carry exactly the three cards of spec §3.2, in table order', () => {
    expect(AuthorityPresetIdValues).toEqual([
      'leave-as-they-are',
      'openlinker-decides',
      'keep-other-system',
    ]);
    expect(Object.keys(AUTHORITY_PRESETS)).toEqual([...AuthorityPresetIdValues]);
  });

  it('should carry a reason for every unavailable preset and none for an available one', () => {
    for (const id of AuthorityPresetIdValues) {
      const preset = AUTHORITY_PRESETS[id];
      expect(preset.unavailableReason === null).toBe(preset.available);
    }
  });

  it('should keep card 3 unavailable until the Wave-4 seam exists', () => {
    expect(AUTHORITY_PRESETS['keep-other-system'].available).toBe(false);
    expect(AUTHORITY_PRESETS['keep-other-system'].unavailableReason).toBe(
      'needs-a-system-that-can-take-over'
    );
  });

  describe('leave-as-they-are', () => {
    it('should return the very same config reference, so no connection is written', () => {
      const original = config({ availabilityAuthority: { enabled: true } });

      expect(AUTHORITY_PRESETS['leave-as-they-are'].mutate(original)).toBe(original);
    });
  });

  describe('openlinker-decides', () => {
    it('should disable a claim while preserving which connection held it and how', () => {
      const original = config({
        availabilityAuthority: {
          enabled: true,
          isPrimary: true,
          scopes: [{ kind: 'location', locationId: 'wh-1' }],
        },
      });

      const next = AUTHORITY_PRESETS['openlinker-decides'].mutate(original) as Record<
        string,
        Record<string, unknown>
      >;

      // The assignment survives: re-enabling restores exactly what was there,
      // which is what makes the preset reversible (#2355's diff).
      expect(next.availabilityAuthority).toEqual({
        enabled: false,
        isPrimary: true,
        scopes: [{ kind: 'location', locationId: 'wh-1' }],
      });
      expect(parseAuthorityConfig(next, 'availability').enabled).toBe(false);
    });

    it('should normalise the zero-ceremony `true` form into a disabled claim', () => {
      const next = AUTHORITY_PRESETS['openlinker-decides'].mutate(
        config({ returnsAuthority: true })
      ) as Record<string, unknown>;

      expect(next.returnsAuthority).toEqual({ enabled: false });
    });

    it('should never touch the refund key — A6 is not assignable, so it is not revocable', () => {
      // ADR-056. The key stays readable so an operator's claim is observable;
      // rewriting it would imply the claim had ever been honoured.
      const original = config({ refundTrigger: true, sourcingAuthority: true });

      const next = AUTHORITY_PRESETS['openlinker-decides'].mutate(original) as Record<
        string,
        unknown
      >;

      expect(next.refundTrigger).toBe(true);
      expect(next.sourcingAuthority).toEqual({ enabled: false });
    });

    it('should return the same reference when nothing is claimed, so nothing is written', () => {
      const original = config({ stockSafetyBuffer: 3 });

      expect(AUTHORITY_PRESETS['openlinker-decides'].mutate(original)).toBe(original);
    });

    it('should leave an already-disabled claim byte-identical rather than rewriting it', () => {
      const original = config({ availabilityAuthority: { enabled: false, isPrimary: true } });

      expect(AUTHORITY_PRESETS['openlinker-decides'].mutate(original)).toBe(original);
    });

    it('should not mutate its argument', () => {
      // Pinned rather than inspected: preview runs this against the LIVE configs,
      // so a mutation here would corrupt an operator's connections while merely
      // previewing.
      const claim = Object.freeze({ enabled: true, isPrimary: false });
      const original = Object.freeze(config({ availabilityAuthority: claim }));

      expect(() => AUTHORITY_PRESETS['openlinker-decides'].mutate(original)).not.toThrow();
      expect(original).toEqual({ availabilityAuthority: { enabled: true, isPrimary: false } });
    });

    it('should preserve every unrelated config key', () => {
      const next = AUTHORITY_PRESETS['openlinker-decides'].mutate(
        config({ stockSafetyBuffer: 3, currency: 'PLN', sourcingAuthority: true })
      ) as Record<string, unknown>;

      expect(next.stockSafetyBuffer).toBe(3);
      expect(next.currency).toBe('PLN');
    });
  });
});

describe('isAuthorityPresetId', () => {
  it.each(AuthorityPresetIdValues)('should accept %s', (id) => {
    expect(isAuthorityPresetId(id)).toBe(true);
  });

  it.each([['orchestrator'], [''], [null], [undefined], [42]])(
    'should reject %p',
    (value: unknown) => {
      expect(isAuthorityPresetId(value)).toBe(false);
    }
  );
});
