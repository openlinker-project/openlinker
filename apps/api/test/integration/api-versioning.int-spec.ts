/**
 * HTTP API Versioning Integration Test (#1133 / ADR-029 Axis 3)
 *
 * Vertical slice covering the URI-versioning contract:
 * - `GET /v1/health` exposes the runtime version surface (product + api).
 * - Versioned routes are served ONLY under `/v1` (unversioned → 404).
 * - The inbound-webhook ingress stays version-neutral (externally-provisioned
 *   URL): reachable without `/v1`, absent under `/v1`.
 * - The Allegro OAuth callback is a normal versioned API endpoint (the FE
 *   callback page calls it with the auth code) — served under `/v1`, not neutral.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, IntegrationTestHarness, teardownTestHarness } from './setup';

describe('HTTP API versioning (#1133)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('runtime version surface', () => {
    it('should expose product + api version at GET /v1/health', async () => {
      const http = harness.getHttp();

      const response = await http.get('/v1/health').expect(200);

      expect(response.body).toMatchObject({
        status: expect.stringMatching(/^(ok|error)$/),
        api: 'v1',
        version: expect.any(String),
      });
      expect(response.body.version.length).toBeGreaterThan(0);
      expect(response.body.services).toBeDefined();
    });
  });

  describe('versioned routes are served only under /v1', () => {
    it('should route a versioned resource under /v1 (auth-gated, not 404)', async () => {
      const http = harness.getHttp();

      // No token → 401 proves the route EXISTS under /v1 (guard ran).
      await http.get('/v1/orders').expect(401);
    });

    it('should 404 the same resource without the /v1 prefix', async () => {
      const http = harness.getHttp();

      await http.get('/orders').expect(404);
    });
  });

  describe('version-neutral carve-out — inbound webhook ingress', () => {
    // An uppercase provider trips the handler's "lowercase letters only" format
    // check → 400. That status is produced ONLY when the route is reached, so it
    // is unambiguous proof of routing (unlike a handler 404 for an unknown
    // connection, which a plain routing miss also returns).
    const NEUTRAL_PROBE = '/webhooks/INVALID/not-a-uuid';

    it('should serve the webhook ingress without /v1 (reaches the handler → 400)', async () => {
      const http = harness.getHttp();

      await http.post(NEUTRAL_PROBE).send({}).expect(400);
    });

    it('should NOT serve the webhook ingress under /v1', async () => {
      const http = harness.getHttp();

      await http.post(`/v1${NEUTRAL_PROBE}`).send({}).expect(404);
    });
  });

  describe('the Allegro OAuth callback is versioned (internal API, not a redirect target)', () => {
    it('should route the callback under /v1 (400 on missing params, not 404)', async () => {
      const http = harness.getHttp();

      await http.get('/v1/integrations/allegro/oauth/callback').expect(400);
    });

    it('should 404 the callback without the /v1 prefix', async () => {
      const http = harness.getHttp();

      await http.get('/integrations/allegro/oauth/callback').expect(404);
    });
  });
});
