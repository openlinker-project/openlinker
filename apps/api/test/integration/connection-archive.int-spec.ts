/**
 * Connection Archive Integration Test (#3657)
 *
 * Drives the soft-delete lifecycle through HTTP against a real database:
 * disable -> archive -> hidden from every list -> restore -> credentials
 * re-entered -> enable. The archive exclusion lives in one repository query,
 * so the assertions that matter here are the ones a mocked query builder
 * cannot make: that the rows really leave `list()` and `listCapabilityAdapters`
 * (including the `includeAllStatuses` path), and that the credential row is
 * really deleted rather than orphaned.
 *
 * @module apps/api/test/integration
 */
import type { DataSource } from 'typeorm';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { createPrestashopWizardConnectionDto } from './fixtures/connection.fixtures';
import { getConnectionById } from './helpers/test-database.helper';
import { loginAsAdmin } from './helpers/test-auth.helper';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';

async function findCredentialRow(
  dataSource: DataSource,
  ref: string
): Promise<IntegrationCredentialOrmEntity | null> {
  return dataSource.getRepository(IntegrationCredentialOrmEntity).findOne({ where: { ref } });
}

describe('Connection archive (#3657)', () => {
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

  async function createDisabledConnection(
    token: string,
    name = 'Retired Store'
  ): Promise<{ id: string; credentialRef: string }> {
    const http = harness.getHttp();
    const created = await http
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send(createPrestashopWizardConnectionDto({ name }))
      .expect(201);
    await http
      .patch(`/v1/connections/${created.body.id}/disable`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const row = await getConnectionById(harness.getDataSource(), created.body.id);
    return { id: created.body.id, credentialRef: row!.credentialsRef.slice('db:'.length) };
  }

  it('should archive a disabled connection, delete its credential and hide it from lists', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);
    const { id, credentialRef } = await createDisabledConnection(token);
    expect(await findCredentialRow(dataSource, credentialRef)).not.toBeNull();

    const archived = await http
      .patch(`/v1/connections/${id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(archived.body.status).toBe('archived');
    expect(archived.body.credentialsStored).toBe(false);
    expect(await findCredentialRow(dataSource, credentialRef)).toBeNull();
    const row = await getConnectionById(dataSource, id);
    expect(row?.status).toBe('archived');
    expect(row?.credentialsRef).toBe('');

    const defaultList = await http
      .get('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(defaultList.body.map((c: { id: string }) => c.id)).not.toContain(id);

    const archivedList = await http
      .get('/v1/connections?status=archived')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(archivedList.body.map((c: { id: string }) => c.id)).toEqual([id]);

    // History links resolve the connection by id, so its name must survive.
    const byId = await http
      .get(`/v1/connections/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(byId.body.name).toBe('Retired Store');
  });

  it('should keep an archived connection out of every capability listing', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);
    const { id } = await createDisabledConnection(token);
    // A disabled sibling that stays disabled: proves the listing really does
    // include non-active connections, so the exclusion below is not vacuous.
    const { id: siblingId } = await createDisabledConnection(token, 'Still Disabled');
    await http
      .patch(`/v1/connections/${id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const integrations = harness.getApp().get<IIntegrationsService>(INTEGRATIONS_SERVICE_TOKEN);
    const allStatuses = await integrations.listCapabilityAdapters({
      capability: 'ProductMaster',
      lazy: true,
      includeAllStatuses: true,
    });

    const listed = allStatuses.map((entry) => entry.connectionId);
    expect(listed).toContain(siblingId);
    expect(listed).not.toContain(id);
  });

  it('should refuse to archive a connection that is not disabled', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);
    const created = await http
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send(createPrestashopWizardConnectionDto())
      .expect(201);

    await http
      .patch(`/v1/connections/${created.body.id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    const row = await getConnectionById(dataSource, created.body.id);
    expect(row?.status).toBe('active');
    expect(row?.credentialsRef.startsWith('db:')).toBe(true);
  });

  it('should refuse to set archived or leave archived through a plain PATCH', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);
    const { id } = await createDisabledConnection(token);

    await http
      .patch(`/v1/connections/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'archived' })
      .expect(400);

    await http
      .patch(`/v1/connections/${id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await http
      .patch(`/v1/connections/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' })
      .expect(409);
    expect((await getConnectionById(dataSource, id))?.status).toBe('archived');
  });

  it('should restore to disabled, accept new credentials and then enable', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);
    const { id } = await createDisabledConnection(token);
    await http
      .patch(`/v1/connections/${id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const restored = await http
      .patch(`/v1/connections/${id}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(restored.body.status).toBe('disabled');
    expect(restored.body.credentialsBacked).toBe(true);
    expect(restored.body.credentialsStored).toBe(false);

    await http
      .put(`/v1/connections/${id}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ credentials: { webserviceApiKey: 'NEW_KEY' } })
      .expect(204);

    const row = await getConnectionById(dataSource, id);
    expect(row?.credentialsRef.startsWith('db:')).toBe(true);
    const credential = await findCredentialRow(dataSource, row!.credentialsRef.slice('db:'.length));
    expect(credential).not.toBeNull();

    const enabled = await http
      .patch(`/v1/connections/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' })
      .expect(200);
    expect(enabled.body.status).toBe('active');
  });

  it('should refuse to restore a connection that is not archived', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);
    const { id } = await createDisabledConnection(token);

    await http
      .patch(`/v1/connections/${id}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });
});
