/**
 * API error code integration test (#3860)
 *
 * Through the real global filter roster (`buildGlobalExceptionFilters`, shared
 * with `main.ts`): every error response carries a `code`, and the fields it
 * carried before are still there. Covers the three paths the code can come
 * from - a Nest exception the catch-all answers, a guard refusal, and a domain
 * error a domain filter answers - plus the body parser's own client errors,
 * which must keep their 4xx status rather than become a 500.
 */
import { randomUUID } from 'node:crypto';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

describe('API error code (integration)', () => {
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

  it('should add the status-family code to an unknown route and keep Nest fields', async () => {
    const res = await harness.getHttp().get('/v1/no-such-route').expect(404);

    const body = res.body as Record<string, unknown>;
    expect(body).toMatchObject({ statusCode: 404, error: 'Not Found', code: 'HTTP_404' });
    expect(typeof body.message).toBe('string');
  });

  it('should add a code to a guard refusal', async () => {
    const res = await harness.getHttp().get('/v1/connections').expect(401);

    expect(res.body).toMatchObject({ statusCode: 401, code: 'HTTP_401' });
  });

  it('should add a code to a NotFoundException thrown by a service', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const res = await http
      .get(`/v1/connections/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found', code: 'HTTP_404' });
  });

  it('should add a code to a domain-filter answer and keep its exception name', async () => {
    // `getCapabilityAdapter` throws ConnectionNotFoundException for an unknown
    // connection; ConnectionExceptionFilter answers it (#1087), not the catch-all.
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const res = await http
      .post('/v1/listings/bulk-create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        connectionId: randomUUID(),
        productIds: ['ol_variant_a'],
        sharedConfig: { stock: 5, publishImmediately: false },
      })
      .expect(404);

    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'ConnectionNotFoundException',
      code: 'HTTP_404',
    });
  });

  it('should keep 400 for malformed JSON', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const res = await http
      .post('/v1/listings/bulk-create')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"connectionId":')
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, code: 'HTTP_400' });
  });

  it('should keep 413 for a body over the size limit instead of a 500', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const res = await http
      .post('/v1/listings/bulk-create')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(1024 * 1024 + 1) }))
      .expect(413);

    expect(res.body).toEqual({
      statusCode: 413,
      message: 'request entity too large',
      code: 'HTTP_413',
    });
  });
});
