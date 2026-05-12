/**
 * Prompt Templates CRUD Integration Test
 *
 * End-to-end verification of the #341 admin surface: full draft →
 * publish → second draft → publish → revert lifecycle against a real
 * Postgres via Testcontainers. Asserts the partial unique index keeps
 * at most one `published` row per `(key, channel)`, and that the
 * `@Roles('admin')` guard rejects non-admin callers.
 *
 * @module apps/api/test/integration
 */
import * as bcrypt from 'bcryptjs';
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

describe('Prompt Templates CRUD Integration', () => {
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

  it('should support the full draft → publish → new draft → publish → revert lifecycle', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const createPayload = {
      key: 'test.template',
      channel: 'allegro' as const,
      systemPrompt: 'Sys v1 {{product.name}}',
      userPromptTemplate: 'User v1 {{product.name}}',
      variables: [{ name: 'product.name', type: 'string', required: true }],
    };

    // Create v1 draft
    const createRes = await http
      .post('/prompt-templates')
      .set('Authorization', `Bearer ${token}`)
      .send(createPayload)
      .expect(201);

    expect(createRes.body.version).toBe(1);
    expect(createRes.body.state).toBe('draft');
    expect(createRes.body.channel).toBe('allegro');
    const v1Id: string = createRes.body.id;

    // Update the draft
    const updateRes = await http
      .patch(`/prompt-templates/${v1Id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ systemPrompt: 'Sys v1 edited {{product.name}}' })
      .expect(200);

    expect(updateRes.body.systemPrompt).toBe('Sys v1 edited {{product.name}}');
    expect(updateRes.body.state).toBe('draft');

    // Publish v1
    const publishV1Res = await http
      .post(`/prompt-templates/${v1Id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(publishV1Res.body.state).toBe('published');
    expect(publishV1Res.body.publishedAt).not.toBeNull();

    // Start v2 draft
    const v2CreateRes = await http
      .post('/prompt-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...createPayload, systemPrompt: 'Sys v2 {{product.name}}' })
      .expect(201);

    expect(v2CreateRes.body.version).toBe(2);
    const v2Id: string = v2CreateRes.body.id;

    // Publish v2 — asserts v1 gets archived
    const publishV2Res = await http
      .post(`/prompt-templates/${v2Id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(publishV2Res.body.state).toBe('published');

    // v1 should now be archived
    const v1AfterRes = await http
      .get(`/prompt-templates/${v1Id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(v1AfterRes.body.state).toBe('archived');

    // Latest published is v2
    const latestRes = await http
      .get('/prompt-templates/latest')
      .query({ key: 'test.template', channel: 'allegro' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(latestRes.body.version).toBe(2);
    expect(latestRes.body.id).toBe(v2Id);

    // Version history returns both, newest first
    const versionsRes = await http
      .get('/prompt-templates/versions')
      .query({ key: 'test.template', channel: 'allegro' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(versionsRes.body).toHaveLength(2);
    expect(versionsRes.body[0].version).toBe(2);
    expect(versionsRes.body[1].version).toBe(1);

    // Revert to v1 — produces a new draft at v3
    const revertRes = await http
      .post('/prompt-templates/revert')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'test.template', channel: 'allegro', version: 1 })
      .expect(201);

    expect(revertRes.body.version).toBe(3);
    expect(revertRes.body.state).toBe('draft');
    expect(revertRes.body.systemPrompt).toBe('Sys v1 edited {{product.name}}');

    // List shows the latest (v3 draft) with hasDraft=true and publishedVersion=2
    const listRes = await http
      .get('/prompt-templates')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].key).toBe('test.template');
    expect(listRes.body[0].channel).toBe('allegro');
    expect(listRes.body[0].latestVersion).toBe(3);
    expect(listRes.body[0].latestId).toBe(revertRes.body.id);
    expect(listRes.body[0].publishedVersion).toBe(2);
    expect(listRes.body[0].publishedId).toBe(v2Id);
    expect(listRes.body[0].hasDraft).toBe(true);
  });

  it('should reject updating a non-draft row', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    // Create + publish a row
    const createRes = await http
      .post('/prompt-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'state.guard',
        channel: 'prestashop',
        systemPrompt: 'sys',
        userPromptTemplate: 'user',
        variables: [],
      })
      .expect(201);
    await http
      .post(`/prompt-templates/${createRes.body.id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Patch on a published row → 400
    await http
      .patch(`/prompt-templates/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ systemPrompt: 'should-fail' })
      .expect(400);
  });

  it('should render a template preview with variable substitution', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const createRes = await http
      .post('/prompt-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'render.test',
        channel: null,
        systemPrompt: 'Hello {{name}}',
        userPromptTemplate: 'Describe {{item}}',
        variables: [
          { name: 'name', type: 'string', required: true },
          { name: 'item', type: 'string', required: true },
        ],
      })
      .expect(201);

    const renderRes = await http
      .post(`/prompt-templates/${createRes.body.id}/render`)
      .set('Authorization', `Bearer ${token}`)
      .send({ values: { name: 'Ada', item: 'cap' } })
      .expect(200);

    expect(renderRes.body.systemPrompt).toBe('Hello Ada');
    expect(renderRes.body.userPrompt).toBe('Describe cap');
    expect(renderRes.body.templateId).toBe(createRes.body.id);
    expect(renderRes.body.version).toBe(1);
  });

  it('should 422 when render misses a required variable', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const createRes = await http
      .post('/prompt-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'render.missing',
        channel: null,
        systemPrompt: '{{name}}',
        userPromptTemplate: '-',
        variables: [{ name: 'name', type: 'string', required: true }],
      })
      .expect(201);

    await http
      .post(`/prompt-templates/${createRes.body.id}/render`)
      .set('Authorization', `Bearer ${token}`)
      .send({ values: {} })
      .expect(422);
  });

  it('should return 403 to non-admin callers', async () => {
    const http = harness.getHttp();
    const viewerToken = await loginAsViewer(harness);

    await http
      .get('/prompt-templates')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);

    await http
      .post('/prompt-templates')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        key: 'role.guard',
        channel: null,
        systemPrompt: 'x',
        userPromptTemplate: 'y',
        variables: [],
      })
      .expect(403);
  });

  it('should return 404 on unknown template id', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    await http
      .get('/prompt-templates/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('should accept any non-empty channel query parameter and return rows for that channel (#580)', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    // Post-#580 channel is open-world (`string`): an unrecognised non-empty
    // value reaches the service verbatim and matches against the DB. No
    // rows are seeded for `'not-a-channel'`, so the response is 200 + [].
    const res = await http
      .get('/prompt-templates')
      .query({ channel: 'not-a-channel' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toEqual([]);
  });

  it('should keep at most one published row per (key, channel) even across platforms', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    // Two rows for the same key but different channels can both be published.
    const prestaRes = await http
      .post('/prompt-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'multi.channel',
        channel: 'prestashop',
        systemPrompt: 'ps sys',
        userPromptTemplate: 'ps user',
        variables: [],
      })
      .expect(201);
    await http
      .post(`/prompt-templates/${prestaRes.body.id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const allegroRes = await http
      .post('/prompt-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'multi.channel',
        channel: 'allegro',
        systemPrompt: 'al sys',
        userPromptTemplate: 'al user',
        variables: [],
      })
      .expect(201);
    await http
      .post(`/prompt-templates/${allegroRes.body.id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // List shows both pairs, each with its own published row.
    const listRes = await http
      .get('/prompt-templates')
      .query({ key: 'multi.channel' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body).toHaveLength(2);
    const channels = listRes.body.map((row: { channel: string }) => row.channel).sort();
    expect(channels).toEqual(['allegro', 'prestashop']);
  });

  it('should delete a draft row', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const createRes = await http
      .post('/prompt-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'delete.test',
        channel: null,
        systemPrompt: 'x',
        userPromptTemplate: 'y',
        variables: [],
      })
      .expect(201);

    await http
      .delete(`/prompt-templates/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await http
      .get(`/prompt-templates/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
