/**
 * Content Editor + AI Suggest API Integration Test
 *
 * Vertical slice covering the shared #339 + #342 HTTP surface:
 *   - GET /products/:id/content           — master + channel panel composition
 *   - POST /products/:id/content/draft    — save draft (master)
 *   - POST /products/:id/content/discard  — clear draft (master)
 *   - POST /products/:id/content/suggest  — AI suggest via the `fake` adapter
 *   - POST /products/:id/content/publish  — master publish goes through the
 *       `ContentDraftService → ContentPublisherPort` pipeline; the
 *       PrestaShop/Allegro adapters are not exercised here — same precedent
 *       as `listings-create-offer.int-spec.ts` (live-credentials gap).
 *
 * The publisher's channel path (OfferManager.updateOfferFields dispatch +
 * offer-discovery + NoLinkedOffers / lacking-capability branches) is
 * covered exhaustively by the publisher's unit spec against mocked ports.
 *
 * Fake AI provider (`OL_AI_PROVIDER=fake`) makes the suggest path
 * deterministic — no network egress.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import { ProductOrmEntity } from '@openlinker/core/products/orm-entities';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';
import * as bcrypt from 'bcryptjs';

async function loginAsViewer(
  harness: IntegrationTestHarness,
  username = 'viewer',
): Promise<string> {
  const passwordHash = await bcrypt.hash('viewer-pass', 4);
  await harness.getDataSource().query(
    `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'viewer')`,
    [username, `${username}@example.com`, passwordHash],
  );
  const response = await harness.getHttp()
    .post('/v1/auth/login')
    .send({ username, password: 'viewer-pass' })
    .expect(200);
  return response.body.access_token as string;
}

async function loginAsOperator(
  harness: IntegrationTestHarness,
  username = 'operator',
): Promise<string> {
  const passwordHash = await bcrypt.hash('operator-pass', 4);
  await harness.getDataSource().query(
    `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'operator')`,
    [username, `${username}@example.com`, passwordHash],
  );
  const response = await harness.getHttp()
    .post('/v1/auth/login')
    .send({ username, password: 'operator-pass' })
    .expect(200);
  return response.body.access_token as string;
}

async function seedProduct(ds: DataSource, suffix: string): Promise<string> {
  const productId = `ol_product_content_int_${suffix}`;
  const repo = ds.getRepository(ProductOrmEntity);
  await repo.save(
    repo.create({
      id: productId,
      name: `Content Int Product ${suffix}`,
      sku: null,
      price: null,
    }),
  );
  return productId;
}

describe('Content Editor + AI Suggest Integration', () => {
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

  describe('GET /products/:id/content', () => {
    it('returns master state + empty channels when no OfferFieldUpdater connection is active', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const productId = await seedProduct(dataSource, 'get-empty');

      const response = await http
        .get(`/v1/products/${productId}/content`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.productId).toBe(productId);
      expect(response.body.master).toEqual({
        baseValue: null,
        draftValue: null,
        hasConflict: false,
        updatedAt: null,
        updatedBy: null,
      });
      expect(Array.isArray(response.body.channels)).toBe(true);
    });
  });

  describe('POST /draft + /discard (master)', () => {
    it('saves and clears a master draft', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const productId = await seedProduct(dataSource, 'draft-1');

      const saved = await http
        .post(`/v1/products/${productId}/content/draft`)
        .set('Authorization', `Bearer ${token}`)
        .send({ connectionId: null, fieldKey: 'description', value: 'my draft' })
        .expect(200);

      expect(saved.body.draftValue).toBe('my draft');
      expect(saved.body.baseValue).toBeNull();
      expect(saved.body.hasConflict).toBe(false);

      // The state endpoint now reflects the draft.
      const state = await http
        .get(`/v1/products/${productId}/content`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(state.body.master.draftValue).toBe('my draft');

      await http
        .post(`/v1/products/${productId}/content/discard`)
        .set('Authorization', `Bearer ${token}`)
        .send({ connectionId: null, fieldKey: 'description' })
        .expect(204);

      const after = await http
        .get(`/v1/products/${productId}/content`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(after.body.master.draftValue).toBeNull();
    });

    it('rejects a value longer than 64 KB', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const productId = await seedProduct(dataSource, 'draft-too-big');

      const oversized = 'x'.repeat(65537);
      await http
        .post(`/v1/products/${productId}/content/draft`)
        .set('Authorization', `Bearer ${token}`)
        .send({ connectionId: null, fieldKey: 'description', value: oversized })
        .expect(400);
    });
  });

  describe('POST /suggest', () => {
    it('answers 422 when no ProductMaster connection claims the product', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const productId = await seedProduct(dataSource, 'suggest-1');

      // The harness has no ProductMaster connection, so nothing claims the
      // seeded product. The suggestion reads the product's OWN master (#4068),
      // finds none, and the controller maps NoProductMasterAdapterException to
      // a 422 - a configuration the operator can fix, never a 500. The happy
      // path with a live master is covered by the unit specs.
      await http
        .post(`/v1/products/${productId}/content/suggest`)
        .set('Authorization', `Bearer ${token}`)
        .send({ channel: 'allegro', tone: 'casual' })
        .expect(422);
    });

    it('validates DTO: tone capped at 64 chars', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const productId = await seedProduct(dataSource, 'suggest-tone-cap');

      await http
        .post(`/v1/products/${productId}/content/suggest`)
        .set('Authorization', `Bearer ${token}`)
        .send({ channel: 'allegro', tone: 'x'.repeat(65) })
        .expect(400);
    });

    it('validates DTO: extraInstructions capped at 1024 chars', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const productId = await seedProduct(dataSource, 'suggest-instr-cap');

      await http
        .post(`/v1/products/${productId}/content/suggest`)
        .set('Authorization', `Bearer ${token}`)
        .send({ channel: 'allegro', extraInstructions: 'x'.repeat(1025) })
        .expect(400);
    });
  });

  describe('POST /publish (master)', () => {
    it('surfaces as 404 when the draft row does not exist', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const productId = await seedProduct(dataSource, 'publish-missing');

      await http
        .post(`/v1/products/${productId}/content/publish`)
        .set('Authorization', `Bearer ${token}`)
        .send({ connectionId: null, fieldKey: 'description' })
        .expect(404);
    });
  });

  describe('role guard (#1873)', () => {
    it('allows viewer to read content state, but returns 403 on every mutating endpoint', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const productId = await seedProduct(dataSource, 'rbac');
      const viewerToken = await loginAsViewer(harness);

      await http
        .get(`/v1/products/${productId}/content`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      await http
        .post(`/v1/products/${productId}/content/draft`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ connectionId: null, fieldKey: 'description', value: 'x' })
        .expect(403);

      await http
        .post(`/v1/products/${productId}/content/discard`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ connectionId: null, fieldKey: 'description' })
        .expect(403);

      await http
        .post(`/v1/products/${productId}/content/publish`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ connectionId: null, fieldKey: 'description' })
        .expect(403);

      await http
        .post(`/v1/products/${productId}/content/suggest`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ channel: 'allegro' })
        .expect(403);
    });

    it('allows operator to read and save/discard/publish drafts, but keeps suggest admin-only', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const productId = await seedProduct(dataSource, 'rbac-operator');
      const operatorToken = await loginAsOperator(harness);

      await http
        .get(`/v1/products/${productId}/content`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      await http
        .post(`/v1/products/${productId}/content/draft`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ connectionId: null, fieldKey: 'description', value: 'operator draft' })
        .expect(200);

      await http
        .post(`/v1/products/${productId}/content/discard`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ connectionId: null, fieldKey: 'description' })
        .expect(204);

      await http
        .post(`/v1/products/${productId}/content/suggest`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ channel: 'allegro' })
        .expect(403);
    });
  });
});
