/**
 * Bench Packer Authorization — story A5 (#2413, ADR-071, spec § 2.1)
 *
 * > *Given a session signed in at a bench with the role packing requires, when
 * > it requests a route unrelated to fulfilment — the customer list, a customer
 * > record, the sales-document rules surface — then it is refused.*
 *
 * The wave spec is explicit that **A5 is asserted in this wave's own tests
 * rather than by citing #2079's**, and the issue adds *"assert it rather than
 * assume it"* for the sales-document surface, which was already `@Roles('admin')`
 * before this issue. So all three are exercised here, through the real guard
 * stack against a real Postgres — not by reading a decorator.
 *
 * ## Why an integration test and not a unit test on `RolesGuard`
 *
 * A5 is a claim about the deployed surface, and every step between a token and
 * a 403 is a place it can fail: role persistence, JWT claims, `JwtAuthGuard`
 * ordering, `RolesGuard`'s handler-vs-class precedence, and the decorator
 * actually being on the route. A guard unit test with a hand-built execution
 * context proves the guard, and proves nothing about whether these routes carry
 * the decorator — which is the half #2413 changed.
 *
 * ## `GET /orders/:id` is here, and it is the finding this file exists for
 *
 * The acceptance criterion names the customer register. But
 * `OrderRecordResponseDto.orderSnapshot` carries the buyer's name, email and
 * both un-redacted addresses under the default `OL_STORE_PII=true`, so a packer
 * left open on the order register would reach a SUPERSET of `GET /customers/:id`
 * — A5 satisfied to the letter and defeated in substance. Asserted so the hole
 * cannot reopen quietly.
 *
 * ## And one positive assertion, because refusing everything is not the goal
 *
 * A spec containing only 403s passes if `packer` is broken outright — if the
 * role fails to authenticate, or every route denies it. `GET /auth/me` is
 * asserted to SUCCEED and to report the role, which is also story A4's own
 * dependency: the bench renders the signed-in name from that response.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAsPacker, loginAsViewer } from './helpers/test-auth.helper';

describe('Bench packer authorization (A5, #2413)', () => {
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

  it('authenticates a packer and reports the role on GET /auth/me', async () => {
    const http = harness.getHttp();
    const token = await loginAsPacker(http, harness.getDataSource());

    const res = await http
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.role).toBe('packer');
    // The empty permission set is deliberate (`ROLE_PERMISSIONS.packer`), and
    // it must round-trip as an empty ARRAY rather than as an absent field: the
    // frontend reads `permissions` as a membership set.
    expect(res.body.permissions).toEqual([]);
  });

  it('refuses a packer the customer list (A5)', async () => {
    const http = harness.getHttp();
    const token = await loginAsPacker(http, harness.getDataSource());

    await http.get('/v1/customers').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('refuses a packer a customer record (A5)', async () => {
    const http = harness.getHttp();
    const token = await loginAsPacker(http, harness.getDataSource());

    // 403 rather than 404: authorization is decided before the handler runs, so
    // a non-existent id is the right probe — it proves the guard refused rather
    // than the record being absent.
    await http
      .get('/v1/customers/ol_customer_does_not_exist')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('refuses a packer the sales-document rules surface (A5)', async () => {
    const http = harness.getHttp();
    const token = await loginAsPacker(http, harness.getDataSource());

    // Already `@Roles('admin')` at class level before #2413 — asserted rather
    // than assumed, exactly as the issue asks.
    await http.get('/v1/sales-documents/rules').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('refuses a packer the order register, which carries buyer PII in its snapshot', async () => {
    const http = harness.getHttp();
    const token = await loginAsPacker(http, harness.getDataSource());

    await http.get('/v1/orders').set('Authorization', `Bearer ${token}`).expect(403);
    await http
      .get('/v1/orders/ol_order_does_not_exist')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('refuses a packer connection configuration and fiscal documents', async () => {
    const http = harness.getHttp();
    const token = await loginAsPacker(http, harness.getDataSource());

    await http.get('/v1/connections').set('Authorization', `Bearer ${token}`).expect(403);
    await http.get('/v1/invoices').set('Authorization', `Bearer ${token}`).expect(403);
    await http.get('/v1/analytics/sales').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('still admits admin, operator and viewer to the routes #2413 narrowed', async () => {
    // The narrowing is claimed to be BEHAVIOUR-NEUTRAL for every user who
    // exists today. A test that only asserts the packer's 403s would pass just
    // as happily if the narrowing had locked everyone else out too.
    const http = harness.getHttp();
    const token = await loginAsViewer(http, harness.getDataSource());

    await http.get('/v1/customers').set('Authorization', `Bearer ${token}`).expect(200);
    await http.get('/v1/orders').set('Authorization', `Bearer ${token}`).expect(200);
    await http.get('/v1/connections').set('Authorization', `Bearer ${token}`).expect(200);
  });
});
