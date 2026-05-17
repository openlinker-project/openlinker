/**
 * Connection Credentials Integration Test
 *
 * Vertical slice for the credentials persistence flow added in #165:
 *  - POST /connections with `credentials` writes integration_credentials
 *    and stores `db:<uuid>` on the connection
 *  - PUT /connections/:id/credentials updates the credential row
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import {
  ICredentialsService,
  CREDENTIALS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { IntegrationTestHarness } from './setup';
import {
  createPrestashopConnectionDto,
  createPrestashopWizardConnectionDto,
} from './fixtures/connection.fixtures';
import { getConnectionById } from './helpers/test-database.helper';
import { loginAsAdmin } from './helpers/test-auth.helper';

async function findRawCredentialByRef(
  dataSource: DataSource,
  ref: string,
): Promise<IntegrationCredentialOrmEntity | null> {
  return dataSource.getRepository(IntegrationCredentialOrmEntity).findOne({ where: { ref } });
}

describe('Connection Credentials Integration', () => {
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

  describe('POST /connections with credentials payload', () => {
    it('persists credentials and stores db: ref on the connection row', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const dto = createPrestashopWizardConnectionDto({ name: 'Wizard Store' });

      const response = await http
        .post('/connections')
        .set('Authorization', `Bearer ${token}`)
        .send(dto)
        .expect(201);

      const connection = await getConnectionById(dataSource, response.body.id);
      expect(connection?.credentialsRef.startsWith('db:')).toBe(true);

      const ref = connection!.credentialsRef.slice('db:'.length);

      // The raw row stores the AES-256-GCM envelope, not plaintext (#709).
      const raw = await findRawCredentialByRef(dataSource, ref);
      expect(raw).toBeDefined();
      expect(raw?.platformType).toBe('prestashop');
      expect(raw?.credentialsCiphertext).not.toContain('WS_KEY_TEST');
      expect(raw?.credentialsCiphertext.length).toBeGreaterThan(20);

      // The credentials service decrypts transparently.
      const credentials = harness
        .getApp()
        .get<ICredentialsService>(CREDENTIALS_SERVICE_TOKEN);
      const decrypted = await credentials.getByRef(ref);
      expect(decrypted.credentialsJson).toEqual({ webserviceApiKey: 'WS_KEY_TEST' });
    });

    it('rejects raw-key credentialsRef without db: prefix', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const dto = createPrestashopConnectionDto({
        credentialsRef: 'RAW_KEY_NO_PREFIX',
      });

      await http
        .post('/connections')
        .set('Authorization', `Bearer ${token}`)
        .send(dto)
        .expect(400);
    });

    it('rejects when both credentials and credentialsRef are provided', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const dto = createPrestashopWizardConnectionDto({
        credentialsRef: 'db:explicit-ref',
      });

      await http
        .post('/connections')
        .set('Authorization', `Bearer ${token}`)
        .send(dto)
        .expect(400);
    });

    it('rejects PrestaShop credentials missing webserviceApiKey', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const dto = createPrestashopWizardConnectionDto({
        credentials: { someOtherField: 'X' },
      });

      await http
        .post('/connections')
        .set('Authorization', `Bearer ${token}`)
        .send(dto)
        .expect(400);
    });
  });

  describe('PUT /connections/:id/credentials', () => {
    it('rotates the stored credential without touching the connection row', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const created = await http
        .post('/connections')
        .set('Authorization', `Bearer ${token}`)
        .send(createPrestashopWizardConnectionDto())
        .expect(201);

      const before = await getConnectionById(dataSource, created.body.id);
      const refBefore = before!.credentialsRef;

      await http
        .put(`/connections/${created.body.id}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .send({ credentials: { webserviceApiKey: 'ROTATED_KEY' } })
        .expect(204);

      const after = await getConnectionById(dataSource, created.body.id);
      expect(after!.credentialsRef).toBe(refBefore);

      const ref = refBefore.slice('db:'.length);
      const credentials = harness
        .getApp()
        .get<ICredentialsService>(CREDENTIALS_SERVICE_TOKEN);
      const credential = await credentials.getByRef(ref);
      expect(credential.credentialsJson).toEqual({ webserviceApiKey: 'ROTATED_KEY' });

      // Ciphertext does not leak the rotated plaintext into raw bytes.
      const raw = await findRawCredentialByRef(dataSource, ref);
      expect(raw?.credentialsCiphertext).not.toContain('ROTATED_KEY');
    });

    it('returns 400 when the connection has a non-db credentials reference', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const created = await http
        .post('/connections')
        .set('Authorization', `Bearer ${token}`)
        .send(createPrestashopConnectionDto({ credentialsRef: 'db:explicit-ref' }))
        .expect(201);

      // Hand-edit the connection row to a legacy raw-key state to simulate
      // the broken pre-#165 connections that the docs say require workaround.
      await dataSource
        .getRepository('connections')
        .update({ id: created.body.id }, { credentialsRef: 'LEGACY_RAW_KEY' });

      await http
        .put(`/connections/${created.body.id}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .send({ credentials: { webserviceApiKey: 'X' } })
        .expect(400);
    });
  });
});
