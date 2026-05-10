/**
 * Allegro Email Normalizer Adapter — Unit Tests
 *
 * Pins the Allegro-specific identity rule: strip `+transactionId` from the
 * local part for `@allegromail.*` addresses, leave everything else to the
 * shared baseline. Previously a special-case branch inside
 * `@openlinker/shared/config::normalizeEmail` (#585 / E5).
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import { AllegroEmailNormalizerAdapter } from '../allegro-email-normalizer.adapter';

describe('AllegroEmailNormalizerAdapter', () => {
  const adapter = new AllegroEmailNormalizerAdapter();

  describe('masked emails (@allegromail.*)', () => {
    it('strips +transactionId from the local part', () => {
      // The canonical Allegro masked-email shape — the transactionId
      // rotates per order while the fixedPart is stable per buyer.
      expect(adapter.normalize('8awgqyk6a5+cub31c122@allegromail.pl')).toBe(
        '8awgqyk6a5@allegromail.pl',
      );
    });

    it('handles the .com TLD variant', () => {
      expect(adapter.normalize('buyer+abc123@allegromail.com')).toBe(
        'buyer@allegromail.com',
      );
    });

    it('lowercases and trims before stripping', () => {
      expect(adapter.normalize('  BUYER+abc123@AllegroMail.PL  ')).toBe(
        'buyer@allegromail.pl',
      );
    });

    it('leaves the address alone when no + is present', () => {
      expect(adapter.normalize('plain@allegromail.pl')).toBe('plain@allegromail.pl');
    });

    it('is idempotent on already-normalized masked addresses', () => {
      const once = adapter.normalize('buyer+x@allegromail.pl');
      expect(adapter.normalize(once)).toBe(once);
    });
  });

  describe('non-Allegro addresses', () => {
    it('falls back to baseline trim+lowercase for ordinary domains', () => {
      expect(adapter.normalize('  Customer@Example.com  ')).toBe('customer@example.com');
    });

    it('preserves + in the local part on non-Allegro domains', () => {
      // RFC 5233 sub-addressing is a real, semantically meaningful feature
      // outside Allegro's masking scheme — we must not strip it elsewhere.
      expect(adapter.normalize('user+inbox@example.com')).toBe('user+inbox@example.com');
    });

    it('returns empty string for empty input', () => {
      expect(adapter.normalize('')).toBe('');
    });
  });
});
