/**
 * MCP Token Auth Integration Test (#1486)
 *
 * The vertical slice this phase exists to prove: mint a token through the
 * admin API → present it as a bearer on `/mcp` → the request authenticates.
 *
 * This is also where the SDK-owned behaviour is asserted for real — the
 * 401/403 split and the `WWW-Authenticate` challenge come from
 * `requireBearerAuth`, so they cannot be verified in a unit test.
 *
 * `/mcp` is VERSION_NEUTRAL: the URL an operator pastes into a client
 * config must not drift under the `/v1` prefix.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

interface MintedToken {
  id: string;
  rawToken: string;
}

/** An initialize request — the first thing any MCP client sends. */
const INITIALIZE_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2026-07-28',
    capabilities: {},
    clientInfo: { name: 'int-spec', version: '1.0.0' },
  },
};

describe('MCP Token Auth Integration (#1486)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function mint(
    adminToken: string,
    body: Record<string, unknown> = { name: 'int-spec token', scope: 'mcp:read' },
  ): Promise<MintedToken> {
    const response = await harness
      .getHttp()
      .post('/v1/mcp/tokens')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);
    return { id: response.body.id, rawToken: response.body.rawToken };
  }

  it('should mint a token, store only its hash, and authenticate an MCP call with it', async () => {
    const http = harness.getHttp();
    const dataSource: DataSource = harness.getDataSource();
    const adminToken = await loginAsAdmin(http, dataSource);

    const minted = await mint(adminToken);
    expect(minted.rawToken.startsWith('olmcp_')).toBe(true);

    // The raw value must not be recoverable from the database.
    const rows = await dataSource.query<{ token_hash: string }[]>(
      `SELECT token_hash FROM mcp_tokens WHERE id = $1`,
      [minted.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(minted.rawToken);

    // …nor from any subsequent read.
    const listed = await http
      .get('/v1/mcp/tokens')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(minted.rawToken);
    // Deployment-wide listing: every row must name its owner.
    expect(listed.body[0].userId).toBeDefined();

    // The token authenticates against the version-neutral MCP endpoint.
    await http
      .post('/mcp')
      .set('Authorization', `Bearer ${minted.rawToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send(INITIALIZE_BODY)
      .expect((res) => {
        if (res.status === 401 || res.status === 403) {
          throw new Error(`Expected the minted token to authenticate, got ${res.status}`);
        }
      });
  });

  it('should reject a request with no Authorization header, with a WWW-Authenticate challenge', async () => {
    const response = await harness
      .getHttp()
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send(INITIALIZE_BODY)
      .expect(401);

    expect(response.headers['www-authenticate']).toMatch(/Bearer/i);
  });

  it('should reject an unknown bearer token', async () => {
    await harness
      .getHttp()
      .post('/mcp')
      .set('Authorization', 'Bearer olmcp_not-a-real-token')
      .set('Accept', 'application/json, text/event-stream')
      .send(INITIALIZE_BODY)
      .expect(401);
  });

  it('should reject a non-OpenLinker passthrough token', async () => {
    await harness
      .getHttp()
      .post('/mcp')
      .set('Authorization', 'Bearer github_pat_11ABCDEFG0123456789')
      .set('Accept', 'application/json, text/event-stream')
      .send(INITIALIZE_BODY)
      .expect(401);
  });

  it('should reject a revoked token', async () => {
    const http = harness.getHttp();
    const adminToken = await loginAsAdmin(http, harness.getDataSource());
    const minted = await mint(adminToken);

    await http
      .delete(`/v1/mcp/tokens/${minted.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    await http
      .post('/mcp')
      .set('Authorization', `Bearer ${minted.rawToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send(INITIALIZE_BODY)
      .expect(401);
  });

  it('should reject a token whose expiry has passed', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const adminToken = await loginAsAdmin(http, dataSource);
    const minted = await mint(adminToken);

    await dataSource.query(`UPDATE mcp_tokens SET expires_at = now() - interval '1 day' WHERE id = $1`, [
      minted.id,
    ]);

    await http
      .post('/mcp')
      .set('Authorization', `Bearer ${minted.rawToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send(INITIALIZE_BODY)
      .expect(401);
  });

  it('should stop authenticating a token whose owning user was deleted', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const adminToken = await loginAsAdmin(http, dataSource);
    const minted = await mint(adminToken);

    const owner = await dataSource.query<{ user_id: string }[]>(
      `SELECT user_id FROM mcp_tokens WHERE id = $1`,
      [minted.id],
    );
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [owner[0].user_id]);

    // NOTE: production DDL cascades this row away (the migration declares
    // `REFERENCES users(id) ON DELETE CASCADE`), but this harness builds its
    // schema with `synchronize`, not migrations — so migration-only FKs are
    // absent here and the row survives the delete. That is precisely why the
    // verifier must ALSO fail closed on a missing owner rather than relying on
    // the cascade: this assertion covers the belt, the migration the braces.
    await http
      .post('/mcp')
      .set('Authorization', `Bearer ${minted.rawToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send(INITIALIZE_BODY)
      .expect(401);
  });

  it('should NOT gate the admin token surface with the MCP bearer middleware', async () => {
    // The middleware is bound to the exact path `mcp` (MCP_TRANSPORT_PATH);
    // Nest middleware paths are exact-match, so `mcp/tokens` must stay on
    // ordinary session auth. If that ever inverted you would need an MCP token
    // in order to mint an MCP token — an unrecoverable chicken-and-egg.
    const http = harness.getHttp();
    const adminToken = await loginAsAdmin(http, harness.getDataSource());

    const response = await http
      .get('/v1/mcp/tokens')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // A session JWT is NOT an MCP token — reaching 200 proves the bearer
    // middleware did not run on this route.
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should require an admin session to mint a token', async () => {
    await harness
      .getHttp()
      .post('/v1/mcp/tokens')
      .send({ name: 'anonymous', scope: 'mcp:read' })
      .expect(401);
  });

  it('should reject an invalid scope at the DTO boundary', async () => {
    const http = harness.getHttp();
    const adminToken = await loginAsAdmin(http, harness.getDataSource());

    await http
      .post('/v1/mcp/tokens')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'bad scope', scope: 'mcp:admin' })
      .expect(400);
  });
});
