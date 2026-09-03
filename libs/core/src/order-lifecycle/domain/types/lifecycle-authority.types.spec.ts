/**
 * Lifecycle Authority — coercer specs (#2305)
 *
 * The coercer reads an untrusted jsonb knob on the ingestion path, so the
 * governing property is that NOTHING wedges it: every malformed shape falls
 * back to the zero-config default rather than throwing or yielding a
 * half-formed `external` authority with no holder.
 *
 * @module libs/core/src/order-lifecycle/domain/types
 */
import {
  DEFAULT_LIFECYCLE_AUTHORITY,
  LifecycleAuthorityModeValues,
  readLifecycleAuthority,
} from './lifecycle-authority.types';

describe('readLifecycleAuthority (#2305)', () => {
  it('should expose the two modes', () => {
    expect(LifecycleAuthorityModeValues).toEqual(['openlinker', 'external']);
  });

  it('should default to openlinker (zero-config)', () => {
    expect(DEFAULT_LIFECYCLE_AUTHORITY).toEqual({ mode: 'openlinker' });
  });

  describe('when the value is absent or not an object', () => {
    it.each([undefined, null, 'external', 42, true, []])(
      'should fall back to the default for %p',
      (value) => {
        expect(readLifecycleAuthority(value)).toEqual({ mode: 'openlinker' });
      },
    );
  });

  describe('when the mode is recognised', () => {
    it('should read openlinker verbatim', () => {
      expect(readLifecycleAuthority({ mode: 'openlinker' })).toEqual({
        mode: 'openlinker',
      });
    });

    it('should read external verbatim when a connectionId is present', () => {
      expect(
        readLifecycleAuthority({ mode: 'external', connectionId: 'conn-1' }),
      ).toEqual({ mode: 'external', connectionId: 'conn-1' });
    });

    it('should ignore extra keys rather than carrying them through', () => {
      expect(
        readLifecycleAuthority({
          mode: 'external',
          connectionId: 'conn-1',
          rogue: 'value',
        }),
      ).toEqual({ mode: 'external', connectionId: 'conn-1' });
    });
  });

  describe('when the mode is external but the holder is unusable', () => {
    /**
     * REVIEW C6: an `external` authority without a holder is the undecidable
     * state the connectionId exists to eliminate — it must never be produced.
     */
    it.each([
      { mode: 'external' },
      { mode: 'external', connectionId: '' },
      { mode: 'external', connectionId: '   ' },
      { mode: 'external', connectionId: null },
      { mode: 'external', connectionId: 42 },
      { mode: 'external', connectionId: {} },
    ])('should fall back to the default for %p', (value) => {
      expect(readLifecycleAuthority(value)).toEqual({ mode: 'openlinker' });
    });
  });

  describe('when the mode is unrecognised', () => {
    it.each([
      { mode: 'vendor' },
      { mode: '' },
      { mode: 7 },
      { connectionId: 'conn-1' },
      {},
    ])('should fall back to the default for %p', (value) => {
      expect(readLifecycleAuthority(value)).toEqual({ mode: 'openlinker' });
    });
  });

  it('should never throw on any input', () => {
    const hostile: unknown[] = [
      Symbol('x'),
      () => undefined,
      new Map(),
      { mode: { nested: true } },
    ];

    hostile.forEach((value) => {
      expect(() => readLifecycleAuthority(value)).not.toThrow();
    });
  });
});
