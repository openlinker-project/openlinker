/**
 * Allegro Connection Token State Tests
 *
 * Unit tests for the per-connection token-state holder. Covers proactive
 * refresh (single-flight + cooldown) and reactive 401 refresh return-value
 * paths. The end-to-end interplay with the HTTP client request loop is
 * already exercised in `allegro-http-client.spec.ts` — these specs target
 * the state class in isolation.
 *
 * @module libs/integrations/allegro/src/infrastructure/http/__tests__
 */
import { Logger } from '@openlinker/shared/logging';
import { AllegroConnectionTokenState } from '../allegro-connection-token-state';
import { AllegroNetworkException } from '../../../domain/exceptions/allegro-network.exception';

describe('AllegroConnectionTokenState', () => {
  const NOW = new Date('2026-04-26T10:00:00.000Z').getTime();
  const COOLDOWN_MS = 5_000;
  const TRACE = 'trace-test';
  const connectionId = 'connection-test';

  let logger: Logger;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    logger = new Logger('AllegroConnectionTokenStateTest');
    jest.spyOn(logger, 'debug').mockImplementation();
    jest.spyOn(logger, 'log').mockImplementation();
    jest.spyOn(logger, 'warn').mockImplementation();
    jest.spyOn(logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('ensureFreshToken — happy path', () => {
    it('refreshes inside the window, updates accessToken, clears any prior cooldown', async () => {
      const callback = jest.fn().mockResolvedValue({
        accessToken: 'fresh-token',
        expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
      });
      const state = new AllegroConnectionTokenState(
        connectionId,
        { accessToken: 'stale-token', expiresAt: new Date(NOW + 30_000) },
        callback,
      );

      await state.ensureFreshToken(TRACE, logger);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(connectionId);
      expect(state.getAccessToken()).toBe('fresh-token');

      // Subsequent call inside the new validity window must NOT refresh again.
      await state.ensureFreshToken(TRACE, logger);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('ensureFreshToken — no-op paths', () => {
    it('no-ops when no callback is registered', async () => {
      const state = new AllegroConnectionTokenState(connectionId, {
        accessToken: 'token',
        expiresAt: new Date(NOW + 30_000),
      });

      await state.ensureFreshToken(TRACE, logger);

      expect(state.getAccessToken()).toBe('token');
    });

    it('no-ops when expiresAt is absent (backward compat)', async () => {
      const callback = jest.fn();
      const state = new AllegroConnectionTokenState(
        connectionId,
        { accessToken: 'token' },
        callback,
      );

      await state.ensureFreshToken(TRACE, logger);

      expect(callback).not.toHaveBeenCalled();
    });

    it('no-ops when current token is well outside the refresh window', async () => {
      const callback = jest.fn();
      const state = new AllegroConnectionTokenState(
        connectionId,
        { accessToken: 'token', expiresAt: new Date(NOW + 10 * 60_000) },
        callback,
      );

      await state.ensureFreshToken(TRACE, logger);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('ensureFreshToken — single-flight', () => {
    it('serializes concurrent callers onto a single in-flight refresh', async () => {
      let resolveRefresh!: (v: { accessToken: string; expiresAt: string }) => void;
      const callback = jest.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      );
      const state = new AllegroConnectionTokenState(
        connectionId,
        { accessToken: 'stale', expiresAt: new Date(NOW + 30_000) },
        callback,
      );

      const p1 = state.ensureFreshToken(TRACE, logger);
      const p2 = state.ensureFreshToken(TRACE, logger);
      const p3 = state.ensureFreshToken(TRACE, logger);

      // All three callers parked on the same refresh promise.
      expect(callback).toHaveBeenCalledTimes(1);

      resolveRefresh({
        accessToken: 'fresh',
        expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
      });
      await Promise.all([p1, p2, p3]);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(state.getAccessToken()).toBe('fresh');
    });
  });

  describe('ensureFreshToken — cooldown', () => {
    it('records cooldown after a failure and skips proactive attempts inside it', async () => {
      const callback = jest
        .fn()
        .mockRejectedValueOnce(new Error('refresh endpoint down'))
        .mockResolvedValueOnce({
          accessToken: 'recovered',
          expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
        });
      const state = new AllegroConnectionTokenState(
        connectionId,
        { accessToken: 'stale', expiresAt: new Date(NOW + 30_000) },
        callback,
      );

      // 1st call: refresh attempt fails (swallowed) — cooldown set.
      await state.ensureFreshToken(TRACE, logger);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(state.getAccessToken()).toBe('stale');

      // Inside the cooldown: no second proactive attempt.
      jest.setSystemTime(NOW + 1_000);
      await state.ensureFreshToken(TRACE, logger);
      expect(callback).toHaveBeenCalledTimes(1);

      // Past the cooldown: proactive resumes; this time it succeeds.
      jest.setSystemTime(NOW + COOLDOWN_MS + 1_000);
      await state.ensureFreshToken(TRACE, logger);
      expect(callback).toHaveBeenCalledTimes(2);
      expect(state.getAccessToken()).toBe('recovered');
    });
  });

  describe('refreshOnUnauthorized', () => {
    it('returns { ok: true } on success and updates accessToken', async () => {
      const callback = jest.fn().mockResolvedValue({
        accessToken: 'recovered',
        expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
      });
      const state = new AllegroConnectionTokenState(
        connectionId,
        { accessToken: 'stale' },
        callback,
      );

      await expect(state.refreshOnUnauthorized(TRACE, logger)).resolves.toEqual({ ok: true });
      expect(state.getAccessToken()).toBe('recovered');
    });

    it('returns { ok: false, reason: "no-callback" } when no callback is registered', async () => {
      const state = new AllegroConnectionTokenState(connectionId, { accessToken: 'token' });

      await expect(state.refreshOnUnauthorized(TRACE, logger)).resolves.toEqual({
        ok: false,
        reason: 'no-callback',
      });
      expect(state.getAccessToken()).toBe('token');
    });

    it('returns { ok: false, reason: "credential-rejected", cause } when the callback throws a generic Error', async () => {
      const cause = new Error('refresh endpoint rejected: invalid_grant');
      const callback = jest.fn().mockRejectedValue(cause);
      const state = new AllegroConnectionTokenState(
        connectionId,
        { accessToken: 'stale' },
        callback,
      );

      await expect(state.refreshOnUnauthorized(TRACE, logger)).resolves.toEqual({
        ok: false,
        reason: 'credential-rejected',
        cause,
      });
      expect(state.getAccessToken()).toBe('stale');
    });

    it('returns { ok: false, reason: "network-failure", cause } when the callback throws AllegroNetworkException (#499)', async () => {
      const cause = new AllegroNetworkException('fetch failed', 'https://allegro.pl/auth/oauth/token');
      const callback = jest.fn().mockRejectedValue(cause);
      const state = new AllegroConnectionTokenState(
        connectionId,
        { accessToken: 'stale' },
        callback,
      );

      await expect(state.refreshOnUnauthorized(TRACE, logger)).resolves.toEqual({
        ok: false,
        reason: 'network-failure',
        cause,
      });
      // Token is NOT updated — caller will surface a transient error and retry.
      expect(state.getAccessToken()).toBe('stale');
    });

    it('logs network failures at warn (not error) so on-call doesn\'t see noise for transient failures (#499)', async () => {
      const callback = jest
        .fn()
        .mockRejectedValue(new AllegroNetworkException('fetch failed'));
      const state = new AllegroConnectionTokenState(
        connectionId,
        { accessToken: 'stale' },
        callback,
      );
      const warnSpy = jest.spyOn(logger, 'warn');
      const errorSpy = jest.spyOn(logger, 'error');

      await state.refreshOnUnauthorized(TRACE, logger);

      // The "Access token expired, attempting refresh" line + the network-
      // failure breadcrumb both go to warn. No error-level log fired.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Token refresh network failure (transient)'),
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('proactive-refresh — regression guards (#499)', () => {
    it('still records the cooldown when the proactive refresh fails with AllegroNetworkException', async () => {
      // Plan §6 R1: the proactive cooldown is correct regardless of the
      // failure cause (network vs auth) — it prevents a refresh storm
      // against a sick endpoint. This test locks that behavior.
      const callback = jest
        .fn()
        .mockRejectedValueOnce(new AllegroNetworkException('fetch failed'))
        .mockResolvedValue({
          accessToken: 'recovered',
          expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
        });
      const state = new AllegroConnectionTokenState(
        connectionId,
        {
          accessToken: 'stale',
          expiresAt: new Date(NOW + 30_000).toISOString(),
        },
        callback,
      );

      // First call hits the network-failed branch — cooldown set.
      await state.ensureFreshToken(TRACE, logger);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(state.getAccessToken()).toBe('stale');

      // Within the cooldown window, a subsequent call short-circuits.
      await state.ensureFreshToken(TRACE, logger);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
});
