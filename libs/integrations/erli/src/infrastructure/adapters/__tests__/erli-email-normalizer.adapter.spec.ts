/**
 * Erli Email Normalizer Adapter — Unit Tests (#995)
 *
 * Pins the DELIBERATELY baseline-only contract: trim + lowercase, with
 * `+suffix` PRESERVED. PROVISIONAL (#992) — Erli's real buyer-email shape is
 * unconfirmed, so stripping any `+suffix` is intentionally NOT done here
 * because it would risk a silent cross-buyer merge via the resolver's
 * single-match reuse (`customer-identity-resolver.service.ts:201`). All fixtures
 * are obviously-fake — no real or guessed Erli relay domain is encoded.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import { ErliEmailNormalizerAdapter } from '../erli-email-normalizer.adapter';

describe('ErliEmailNormalizerAdapter', () => {
  const adapter = new ErliEmailNormalizerAdapter();

  it('PRESERVES +suffix in the local part (load-bearing fail-safe)', () => {
    // #992: baseline-only by design — stripping +suffix would risk a cross-buyer
    // merge (resolver single-match reuse). Tighten to a domain-gated strip only
    // when Erli's relay domain is confirmed. Two distinct buyers must NOT collapse.
    expect(adapter.normalize('user+shop@gmail.com')).toBe('user+shop@gmail.com');
    expect(adapter.normalize('user+shopA@gmail.com')).not.toBe(
      adapter.normalize('user+shopB@gmail.com'),
    );
  });

  it('lowercases and trims, keeping the sub-address', () => {
    expect(adapter.normalize('  BUYER+abc@Example.Test  ')).toBe('buyer+abc@example.test');
  });

  it('applies trim + lowercase to a plain address', () => {
    expect(adapter.normalize('  Plain@Example.com ')).toBe('plain@example.com');
  });

  it('is idempotent', () => {
    const once = adapter.normalize('  Buyer+x@Example.Test  ');
    expect(adapter.normalize(once)).toBe(once);
  });

  it('returns empty string for empty input', () => {
    expect(adapter.normalize('')).toBe('');
  });

  it('never logs', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    adapter.normalize('buyer+x@example.test');

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
