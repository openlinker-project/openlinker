/**
 * AI Provider Settings Integration Test
 *
 * Vertical slice covering the #398 admin surface plus the storage
 * round-trip against a real Postgres via Testcontainers.
 *
 * The harness boots with `OL_AI_PROVIDER=fake` (matching every other
 * int-spec), so the wired `CredentialsAiProviderAdapter` instance is
 * locked to fake mode. That lets us assert two complementary things:
 *
 *   1. **HTTP behaviour in fake mode**: `GET` returns the fake-shape view
 *      without any DB / env lookup; `PUT` and `DELETE` return 400 with the
 *      `AiProviderSettingsNotApplicableError` message; non-admin callers
 *      are blocked at the `@Roles('admin')` guard.
 *
 *   2. **Storage round-trip (provider-agnostic)**: encrypt → store →
 *      retrieve → decrypt → equal-to-original, exercised directly against
 *      `IntegrationCredentialRepositoryPort` + `CryptoService` so the
 *      result is independent of which provider the booted adapter
 *      selected. This is the issue's AC.
 *
 * @module apps/api/test/integration
 */
import * as bcrypt from 'bcryptjs';
import {
  CredentialNotFoundException,
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
  IntegrationCredentialRepositoryPort,
} from '@openlinker/core/integrations';
import { aiProviderCredentialsRef } from '@openlinker/core/ai';
import { CryptoService } from '@openlinker/shared';
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
    .post('/auth/login')
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
    it('returns the fake-mode view when OL_AI_PROVIDER=fake', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const res = await http
        .get('/ai-provider-settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({
        provider: 'fake',
        configured: false,
        source: 'none',
      });
      expect(res.body.apiKey).toBeUndefined();
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('returns 403 to non-admin callers', async () => {
      const http = harness.getHttp();
      const viewerToken = await loginAsViewer(harness);

      await http
        .get('/ai-provider-settings')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
    });
  });

  describe('PUT /ai-provider-settings', () => {
    it('returns 400 when active provider is fake', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const res = await http
        .put('/ai-provider-settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ apiKey: 'sk-ant-pretend-key-1234567890' })
        .expect(400);

      expect(res.body.message).toMatch(/does not require an API key/i);
    });

    it('rejects empty / too-short API keys with 400', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .put('/ai-provider-settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ apiKey: '' })
        .expect(400);

      await http
        .put('/ai-provider-settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ apiKey: 'short' })
        .expect(400);
    });

    it('returns 403 to non-admin callers', async () => {
      const http = harness.getHttp();
      const viewerToken = await loginAsViewer(harness);

      await http
        .put('/ai-provider-settings')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ apiKey: 'sk-ant-test-key-12345' })
        .expect(403);
    });
  });

  describe('DELETE /ai-provider-settings', () => {
    it('returns 400 when active provider is fake', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const res = await http
        .delete('/ai-provider-settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(res.body.message).toMatch(/does not require an API key/i);
    });

    it('returns 403 to non-admin callers', async () => {
      const http = harness.getHttp();
      const viewerToken = await loginAsViewer(harness);

      await http
        .delete('/ai-provider-settings')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
    });
  });

  describe('storage round-trip against real Postgres', () => {
    it('encrypts → stores → retrieves → decrypts to the original key', async () => {
      const app = harness.getApp();
      const repository = app.get<IntegrationCredentialRepositoryPort>(
        INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
      );
      const crypto = app.get(CryptoService);

      const ref = aiProviderCredentialsRef('anthropic');
      const plaintext = 'sk-ant-real-shape-but-fake-value-abc123';
      const ciphertext = crypto.encrypt(plaintext);

      // Sanity: the cipher is not the plaintext (else encryption is a no-op).
      expect(ciphertext).not.toBe(plaintext);
      expect(ciphertext.length).toBeGreaterThan(plaintext.length);

      // Persist via the repository (real Postgres write).
      const created = await repository.create({
        ref,
        platformType: 'anthropic',
        credentialsJson: { ciphertext },
        encrypted: true,
      });

      expect(created.ref).toBe(ref);
      expect(created.encrypted).toBe(true);
      expect(created.credentialsJson).toEqual({ ciphertext });

      // Retrieve and decrypt.
      const retrieved = await repository.getByRef(ref);
      const retrievedCipher = retrieved.credentialsJson?.ciphertext;
      expect(typeof retrievedCipher).toBe('string');
      const decrypted = crypto.decrypt(retrievedCipher as string);

      expect(decrypted).toBe(plaintext);

      // Cleanup leaves the row absent for the next test.
      await repository.delete(ref);
      await expect(repository.getByRef(ref)).rejects.toBeInstanceOf(
        CredentialNotFoundException,
      );
    });

    it('persists at ref = ai-provider:{provider} (matches the service contract)', () => {
      expect(aiProviderCredentialsRef('anthropic')).toBe('ai-provider:anthropic');
    });
  });
});
