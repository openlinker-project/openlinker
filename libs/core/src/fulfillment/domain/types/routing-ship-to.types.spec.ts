import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildRoutingShipTo,
  ROUTING_SHIP_TO_ALLOWED_KEYS,
  ROUTING_SHIP_TO_FORBIDDEN_KEYS,
  type HashedRoutingShipTo,
  type PlainRoutingShipTo,
  type RoutingShipTo,
  type RoutingShipToSource,
} from './routing-ship-to.types';

/**
 * `keyof (A | B)` resolves to the INTERSECTION of the arms' keys, so a bare
 * `keyof RoutingShipTo` is `'mode' | 'countryIso2'` and an assertion built on it
 * would read `never` whether or not an arm carried a forbidden field — vacuous,
 * and green forever. This distributes over the union so every arm's keys are
 * actually examined.
 */
type KeysOf<T> = T extends unknown ? keyof T : never;

/**
 * The allowlist guard proper, per arm.
 *
 * `Exclude` over the declared keys is what makes "no arm can carry a field its
 * allowlist does not name" true — ANY unlisted field is a `tsc` error, not just
 * one whose name someone thought to enumerate. The `Extract` check below is a
 * readability aid naming the fields this exists to keep out; it is not the guard,
 * and on its own it would pass for a `street` or a `company` nobody listed.
 */
type UnallowedPlainKeys = Exclude<
  keyof PlainRoutingShipTo,
  (typeof ROUTING_SHIP_TO_ALLOWED_KEYS.plain)[number]
>;
const _noUnallowedPlainKeys: UnallowedPlainKeys extends never ? true : never = true;

type UnallowedHashedKeys = Exclude<
  keyof HashedRoutingShipTo,
  (typeof ROUTING_SHIP_TO_ALLOWED_KEYS.hashed)[number]
>;
const _noUnallowedHashedKeys: UnallowedHashedKeys extends never ? true : never = true;

/** Names the forbidden fields explicitly, on top of the allowlist above. */
type ForbiddenShipToKeys = Extract<
  KeysOf<RoutingShipTo>,
  'name' | 'email' | 'phone' | 'address1' | 'address2'
>;
const _noForbiddenShipToKeys: ForbiddenShipToKeys extends never ? true : never = true;

describe('buildRoutingShipTo', () => {
  const source: RoutingShipToSource = {
    countryIso2: 'PL',
    postalCode: '00-001',
    city: 'Warszawa',
    addressHash: 'a'.repeat(64),
  };

  it('should keep the compile-time allowlist assertions referenced', () => {
    expect(_noForbiddenShipToKeys).toBe(true);
    expect(_noUnallowedPlainKeys).toBe(true);
    expect(_noUnallowedHashedKeys).toBe(true);
  });

  describe('when the deployment stores PII', () => {
    it('should project only the allowlisted plain keys', () => {
      const result = buildRoutingShipTo(source, { storePii: true });

      expect(Object.keys(result).sort()).toEqual([...ROUTING_SHIP_TO_ALLOWED_KEYS.plain].sort());
      expect(result).toEqual({
        mode: 'plain',
        countryIso2: 'PL',
        postalCode: '00-001',
        city: 'Warszawa',
      });
    });

    it('should never emit a forbidden buyer-identifying key when the source carries one', () => {
      const contaminated = {
        ...source,
        name: 'Jan Kowalski',
        email: 'jan@example.com',
        phone: '+48123456789',
        address1: 'ul. Testowa 1',
        address2: 'm. 4',
      } as RoutingShipToSource;

      const result = buildRoutingShipTo(contaminated, { storePii: true });

      for (const forbidden of ROUTING_SHIP_TO_FORBIDDEN_KEYS) {
        expect(Object.keys(result)).not.toContain(forbidden);
      }
    });

    it('should normalise an empty postal code or city to null', () => {
      const result = buildRoutingShipTo(
        { countryIso2: 'PL', postalCode: '', city: '' },
        { storePii: true },
      );

      expect(result).toEqual({ mode: 'plain', countryIso2: 'PL', postalCode: null, city: null });
    });

    it('should report an absent postal code or city as null rather than dropping the key', () => {
      const result = buildRoutingShipTo({ countryIso2: 'DE' }, { storePii: true });

      expect(result).toEqual({ mode: 'plain', countryIso2: 'DE', postalCode: null, city: null });
    });
  });

  describe('when the deployment is hash-only (OL_STORE_PII=false)', () => {
    it('should produce the degraded hash-only shape with no postalCode or city key at all', () => {
      const result = buildRoutingShipTo(source, { storePii: false });

      expect(Object.keys(result).sort()).toEqual([...ROUTING_SHIP_TO_ALLOWED_KEYS.hashed].sort());
      expect(result).toEqual({
        mode: 'hashed',
        countryIso2: 'PL',
        locationHash: 'a'.repeat(64),
      });
      // Absent, not null: a null-valued key is still a key the allowlist admits.
      expect('postalCode' in result).toBe(false);
      expect('city' in result).toBe(false);
    });

    it('should pass the caller-supplied hash through unchanged rather than deriving one', () => {
      const result = buildRoutingShipTo({ ...source, addressHash: 'deadbeef' }, { storePii: false });

      expect(result).toEqual({ mode: 'hashed', countryIso2: 'PL', locationHash: 'deadbeef' });
    });

    /**
     * The regression this shape exists for. Recomputing the hash inside core
     * would hash an address `redactAddress` has already blanked, yielding one
     * value per COUNTRY — a plausible 64-hex string that groups the whole
     * install while looking correct.
     */
    it('should distinguish two different addresses in the same country', () => {
      const first = buildRoutingShipTo(
        { countryIso2: 'PL', addressHash: 'hash-warszawa' },
        { storePii: false },
      );
      const second = buildRoutingShipTo(
        { countryIso2: 'PL', addressHash: 'hash-krakow' },
        { storePii: false },
      );

      expect(first).not.toEqual(second);
      expect((first as { locationHash: string }).locationHash).not.toBe(
        (second as { locationHash: string }).locationHash,
      );
    });

    it('should treat a blank hash as absent rather than as a shared grouping key', () => {
      for (const blank of ['', '   ']) {
        const result = buildRoutingShipTo(
          { countryIso2: 'PL', addressHash: blank },
          { storePii: false },
        );

        expect(result).toEqual({ mode: 'hashed', countryIso2: 'PL', locationHash: null });
      }
    });

    it('should report a missing hash as null rather than fabricating a grouping key', () => {
      const result = buildRoutingShipTo({ countryIso2: 'PL' }, { storePii: false });

      expect(result).toEqual({ mode: 'hashed', countryIso2: 'PL', locationHash: null });
    });

    it('should still carry the country, which is not PII and is the primary routing filter', () => {
      const result = buildRoutingShipTo({ countryIso2: 'CZ' }, { storePii: false });

      expect(result.countryIso2).toBe('CZ');
    });
  });

  describe('source discipline', () => {
    it('should derive no hash itself, so no salted hashing rule gains a second call site', () => {
      const source_ = readFileSync(join(__dirname, 'routing-ship-to.types.ts'), 'utf8');
      const withoutComments = source_
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*$/gm, ' ');

      expect(withoutComments).not.toContain('hashAddress');
      expect(withoutComments).not.toContain('createHash');
      expect(withoutComments).not.toContain('getPiiConfig');
    });
  });
});
