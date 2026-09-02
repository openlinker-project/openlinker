import { parseAuthorityConfig } from './authority-config.types';

const UNHELD = { enabled: false, isPrimary: false, scopes: [] };

describe('parseAuthorityConfig', () => {
  it.each([undefined, null, 'true', 42, [], () => undefined])(
    'should default to unheld when the whole config is %p',
    (config) => {
      expect(parseAuthorityConfig(config, 'availability')).toEqual(UNHELD);
    },
  );

  it.each([{}, { unrelated: true }, { availabilityAuthority: 'yes' }, { availabilityAuthority: 0 }])(
    'should default to unheld when the key is missing or garbage in %p',
    (config) => {
      // Defaulting to UNHELD is the load-bearing direction: a typo must never
      // hand physical control to a party.
      expect(parseAuthorityConfig(config, 'availability')).toEqual(UNHELD);
    },
  );

  it('should read a bare boolean claim as enabled, unscoped and not primary', () => {
    expect(parseAuthorityConfig({ availabilityAuthority: true }, 'availability')).toEqual({
      enabled: true,
      isPrimary: false,
      scopes: [],
    });
  });

  it("should accept the string 'true' as a hand-edited JSON config would supply it", () => {
    expect(parseAuthorityConfig({ availabilityAuthority: 'true' }, 'availability')).toEqual({
      enabled: true,
      isPrimary: false,
      scopes: [],
    });
    expect(
      parseAuthorityConfig(
        { availabilityAuthority: { enabled: 'true', isPrimary: 'true' } },
        'availability',
      ),
    ).toEqual({ enabled: true, isPrimary: true, scopes: [] });
  });

  it('should stay unheld when an object claim is explicitly disabled', () => {
    expect(
      parseAuthorityConfig(
        { availabilityAuthority: { enabled: false, isPrimary: true, scopes: [{ kind: 'global' }] } },
        'availability',
      ),
    ).toEqual(UNHELD);
  });

  it('should read each authority through its own config key', () => {
    const config = { sourcingAuthority: true, returnsAuthority: true };
    expect(parseAuthorityConfig(config, 'sourcing').enabled).toBe(true);
    expect(parseAuthorityConfig(config, 'returns-disposition').enabled).toBe(true);
    expect(parseAuthorityConfig(config, 'availability').enabled).toBe(false);
    expect(parseAuthorityConfig(config, 'fulfillment-execution').enabled).toBe(false);
  });

  it('should keep the valid scopes when one malformed entry sits among them', () => {
    const result = parseAuthorityConfig(
      {
        availabilityAuthority: {
          enabled: true,
          scopes: [
            { kind: 'location', locationId: 'loc-a' },
            { kind: 'location' },
            { kind: 'nonsense', locationId: 'loc-b' },
            null,
            'global',
            { kind: 'channel', connectionId: 'conn-1' },
          ],
        },
      },
      'availability',
    );
    // Dropping the whole list would silently withhold an authority the operator
    // did configure correctly.
    expect(result).toEqual({
      enabled: true,
      isPrimary: false,
      scopes: [
        { kind: 'location', locationId: 'loc-a' },
        { kind: 'channel', connectionId: 'conn-1' },
      ],
    });
  });

  it('should ignore a non-array scopes value rather than throwing', () => {
    expect(() =>
      parseAuthorityConfig({ availabilityAuthority: { enabled: true, scopes: 'global' } }, 'availability'),
    ).not.toThrow();
    expect(
      parseAuthorityConfig({ availabilityAuthority: { enabled: true, scopes: 'global' } }, 'availability'),
    ).toEqual({ enabled: true, isPrimary: false, scopes: [] });
  });

  it('should be pure — same input twice, deep-equal output, argument untouched', () => {
    const config = {
      refundTrigger: { enabled: true, isPrimary: true, scopes: [{ kind: 'global' }] },
    };
    const snapshot = JSON.parse(JSON.stringify(config)) as unknown;

    const first = parseAuthorityConfig(config, 'refund-trigger');
    const second = parseAuthorityConfig(config, 'refund-trigger');

    expect(first).toEqual(second);
    expect(JSON.parse(JSON.stringify(config))).toEqual(snapshot);
  });

  it('should report an A6 claim without that ever meaning delegation', () => {
    // Refund authority never leaves OL (ADR-056). The key is read so a claim is
    // OBSERVABLE; no consumer may treat this as a grant.
    expect(parseAuthorityConfig({ refundTrigger: true }, 'refund-trigger').enabled).toBe(true);
  });
});
