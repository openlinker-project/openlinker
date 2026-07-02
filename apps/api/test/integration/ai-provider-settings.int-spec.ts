/**
 * AI Provider Settings Integration Test
 *
 * Vertical slice covering the multi-provider admin surface (#451 / #452):
 *
 *   - GET    /ai-provider-settings                 → multi-provider view
 *   - PUT    /ai-provider-settings/keys/:provider  → set/rotate per-provider key
 *   - DELETE /ai-provider-settings/keys/:provider  → clear per-provider key
 *   - PUT    /ai-provider-settings/active          → switch active provider
 *
 * Plus the storage round-trip against a real Postgres via Testcontainers
 * to confirm the encrypt → store → retrieve → decrypt path is provider-agnostic.
 *
 * The harness boots with `OL_AI_PROVIDER=fake` (matching every other
 * int-spec). Under the new multi-provider contract the env value seeds
 * the active selection only when no DB row exists; key writes are no
 * longer gated on env-active selection — every provider has its own slot.
 *
 * @module apps/api/test/integration
 */
import * as bcrypt from 'bcryptjs';
import {
  CredentialNotFoundException,
  CREDENTIALS_SERVICE_TOKEN,
  ICredentialsService,
} from '@openlinker/core/integrations';
import { aiProviderCredentialsRef } from '@openlinker/core/ai';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

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

describe('AI Provider Settings Integration', () => {
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

  describe('GET /ai-provider-settings', () => {
    it('returns the multi-provider view with active=fake on a clean boot (env fallback)', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const res = await http
        .get('/v1/ai-provider-settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({
        activeProvider: 'fake',
        activeUpdatedAt: null,
        activeUpdatedBy: null,
        providers: [
          { provider: 'anthropic', configured: false, source: 'none' },
          { provider: 'openai', configured: false, source: 'none' },
          { provider: 'fake', configured: false, source: 'none' },
        ],
      });
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('returns 403 to non-admin callers', async () => {
      const http = harness.getHttp();
      const viewerToken = await loginAsViewer(harness);

      await http
        .get('/v1/ai-provider-settings')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
    });
  });

  describe('PUT /ai-provider-settings/keys/:provider', () => {
    it('persists an encrypted key for a provider that requires one (anthropic)', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .put('/v1/ai-provider-settings/keys/anthropic')
        .set('Authorization', `Bearer ${token}`)
        .send({ apiKey: 'sk-ant-pretend-key-1234567890' })
        .expect(204);

      // GET reflects the new state — anthropic is configured from db.
      const res = await http
        .get('/v1/ai-provider-settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const anthropicRow = (res.body.providers as Array<{ provider: string }>).find(
        (row) => row.provider === 'anthropic',
      );
      expect(anthropicRow).toEqual({
        provider: 'anthropic',
        configured: true,
        source: 'db',
      });
    });

    it('returns 400 when the provider does not require a key (fake)', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const res = await http
        .put('/v1/ai-provider-settings/keys/fake')
        .set('Authorization', `Bearer ${token}`)
        .send({ apiKey: 'sk-anything-pretend-1234567890' })
        .expect(400);

      expect(res.body.message).toMatch(/does not require an API key/i);
    });

    it('returns 404 for an unknown provider in the URL', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .put('/v1/ai-provider-settings/keys/cohere')
        .set('Authorization', `Bearer ${token}`)
        .send({ apiKey: 'sk-cohere-pretend-1234567890' })
        .expect(404);
    });

    it('rejects empty / too-short API keys with 400', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .put('/v1/ai-provider-settings/keys/anthropic')
        .set('Authorization', `Bearer ${token}`)
        .send({ apiKey: '' })
        .expect(400);

      await http
        .put('/v1/ai-provider-settings/keys/anthropic')
        .set('Authorization', `Bearer ${token}`)
        .send({ apiKey: 'short' })
        .expect(400);
    });

    it('returns 403 to non-admin callers', async () => {
      const http = harness.getHttp();
      const viewerToken = await loginAsViewer(harness);

      await http
        .put('/v1/ai-provider-settings/keys/anthropic')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ apiKey: 'sk-ant-pretend-1234567890' })
        .expect(403);
    });
  });

  describe('DELETE /ai-provider-settings/keys/:provider', () => {
    it('returns 400 for a provider that does not require a key (fake)', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const res = await http
        .delete('/v1/ai-provider-settings/keys/fake')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(res.body.message).toMatch(/does not require an API key/i);
    });

    it('returns 403 to non-admin callers', async () => {
      const http = harness.getHttp();
      const viewerToken = await loginAsViewer(harness);

      await http
        .delete('/v1/ai-provider-settings/keys/anthropic')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
    });
  });

  describe('PUT /ai-provider-settings/active', () => {
    it('returns 422 when the target provider has no key configured', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const res = await http
        .put('/v1/ai-provider-settings/active')
        .set('Authorization', `Bearer ${token}`)
        .send({ provider: 'anthropic' })
        .expect(422);

      expect(res.body.message).toMatch(/no API key configured/i);
    });

    it('switches the active provider when the target has a key configured', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      // Seed: store a key for openai.
      await http
        .put('/v1/ai-provider-settings/keys/openai')
        .set('Authorization', `Bearer ${token}`)
        .send({ apiKey: 'sk-openai-pretend-1234567890' })
        .expect(204);

      // Activate openai.
      await http
        .put('/v1/ai-provider-settings/active')
        .set('Authorization', `Bearer ${token}`)
        .send({ provider: 'openai' })
        .expect(204);

      // GET reflects the change + the activeUpdated{At,By} fields are populated.
      const res = await http
        .get('/v1/ai-provider-settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.activeProvider).toBe('openai');
      expect(res.body.activeUpdatedAt).toEqual(expect.any(String));
      // The integration harness populates the user with `id` available on the
      // JWT — `activeUpdatedBy` is the bearer's user id, not necessarily
      // `'admin'`. Asserting non-null is sufficient.
      expect(res.body.activeUpdatedBy).not.toBeNull();
    });

    it('allows activating fake without requiring a key', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .put('/v1/ai-provider-settings/active')
        .set('Authorization', `Bearer ${token}`)
        .send({ provider: 'fake' })
        .expect(204);

      const res = await http
        .get('/v1/ai-provider-settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.activeProvider).toBe('fake');
    });

    it('rejects an unknown provider value in the body with 400', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .put('/v1/ai-provider-settings/active')
        .set('Authorization', `Bearer ${token}`)
        .send({ provider: 'cohere' })
        .expect(400);
    });

    it('returns 403 to non-admin callers', async () => {
      const http = harness.getHttp();
      const viewerToken = await loginAsViewer(harness);

      await http
        .put('/v1/ai-provider-settings/active')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ provider: 'fake' })
        .expect(403);
    });
  });

  describe('storage round-trip against real Postgres', () => {
    it('writes plaintext via the service; raw column stores ciphertext; getByRef round-trips (#709)', async () => {
      const app = harness.getApp();
      const credentials = app.get<ICredentialsService>(CREDENTIALS_SERVICE_TOKEN);
      const dataSource = harness.getDataSource();

      const ref = aiProviderCredentialsRef('openai');
      const plaintext = 'sk-openai-real-shape-but-fake-value-abc123';

      const created = await credentials.create({
        ref,
        platformType: 'openai',
        credentialsJson: { apiKey: plaintext },
      });

      expect(created.ref).toBe(ref);
      expect(created.credentialsJson).toEqual({ apiKey: plaintext });

      // Raw column must not contain the plaintext (TypeORM keeps the camelCase
      // column name when no `name:` is set on the @Column decorator).
      const rawRows = await dataSource.query<Array<{ credentialsCiphertext: string }>>(
        `SELECT "credentialsCiphertext" FROM integration_credentials WHERE ref = $1`,
        [ref],
      );
      expect(rawRows).toHaveLength(1);
      expect(rawRows[0].credentialsCiphertext).not.toContain(plaintext);
      expect(rawRows[0].credentialsCiphertext.length).toBeGreaterThan(plaintext.length);

      // getByRef decrypts transparently.
      const retrieved = await credentials.getByRef(ref);
      expect(retrieved.credentialsJson).toEqual({ apiKey: plaintext });

      await credentials.delete(ref);
      await expect(credentials.getByRef(ref)).rejects.toBeInstanceOf(CredentialNotFoundException);
    });

    it('persists at ref = ai-provider:{provider} (matches the service contract)', () => {
      expect(aiProviderCredentialsRef('anthropic')).toBe('ai-provider:anthropic');
      expect(aiProviderCredentialsRef('openai')).toBe('ai-provider:openai');
    });
  });
});
