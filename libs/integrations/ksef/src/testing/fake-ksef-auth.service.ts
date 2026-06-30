/**
 * Fake KSeF Auth Handshake — test double
 *
 * Returns a fixed `KsefAuthenticationToken` (a short-lived JWT with a
 * configurable `exp`) without running the real challenge/redeem handshake or
 * needing a real cert / HTTP client. Lets adapter + client unit specs exercise
 * the token lifecycle (proactive/reactive refresh) deterministically.
 *
 * Mints a real (unsigned) JWT shape so `parseJwtExpiry` round-trips against the
 * seeded expiry. Consumed only from `*.spec.ts`.
 *
 * DEFERRED (C4): the qualified-seal / XAdES path is not modelled here — when
 * real X.509/HSM signing lands, this harness will need a signing fixture; for
 * C3 it covers only the ksef-token happy path.
 *
 * @module libs/integrations/ksef/src/testing
 */
import type { KsefAuthenticationToken } from '../infrastructure/http/ksef-http-client.types';

/** Build an unsigned JWT whose payload carries the given `exp` (epoch seconds). */
function makeFakeJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.`;
}

export class FakeKsefAuthHandshakeService {
  authenticateCalls = 0;

  constructor(private expiresAt: Date = new Date(Date.now() + 60 * 60_000)) {}

  /** Override the token expiry returned by the next `authenticate`. */
  setExpiry(expiresAt: Date): this {
    this.expiresAt = expiresAt;
    return this;
  }

  authenticate(): Promise<KsefAuthenticationToken> {
    this.authenticateCalls += 1;
    const expSeconds = Math.floor(this.expiresAt.getTime() / 1000);
    return Promise.resolve({
      accessToken: makeFakeJwt(expSeconds),
      refreshToken: makeFakeJwt(expSeconds + 3600),
      accessTokenExpiresAt: this.expiresAt,
    });
  }
}
