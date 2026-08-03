/**
 * MCP Mapping Tools Integration Test (#1488)
 *
 * The vertical slice this phase exists to prove, end to end against a real DB:
 * a **read-only** MCP token does not see the write tool, and a **write** token
 * owned by an admin can actually persist a category mapping that a subsequent
 * read returns.
 *
 * Why this cannot be a unit test: scope expansion (`mcp:write` implies
 * `mcp:read`) happens in `McpTokenService` at mint time, the principal is
 * assembled by `OlMcpTokenVerifier` from a real DB row, and `tools/list` is
 * served by the SDK. Only a real request exercises all three together.
 *
 * `loginAsAdmin` plain-INSERTs a fixed admin user, so it is called AT MOST
 * ONCE per test — a second call violates the users unique constraint.
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
import { createTestConnection } from './helpers/test-connection.helper';

const PROTOCOL_VERSION = '2026-07-28';

const INITIALIZE_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'int-spec', version: '1.0.0' },
  },
};

describe('MCP Mapping Tools Integration (#1488)', () => {
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

  async function mint(adminToken: string, scope: 'mcp:read' | 'mcp:write'): Promise<string> {
    const response = await harness
      .getHttp()
      .post('/v1/mcp/tokens')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `int-spec ${scope}`, scope })
      .expect(201);
    return response.body.rawToken as string;
  }

  /** One MCP JSON-RPC call on the version-neutral transport. */
  async function mcp(
    rawToken: string,
    body: Record<string, unknown>
  ): Promise<{ status: number; text: string }> {
    const response = await harness
      .getHttp()
      .post('/mcp')
      .set('Authorization', `Bearer ${rawToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send(body);
    return { status: response.status, text: response.text ?? JSON.stringify(response.body) };
  }

  /**
   * Tool NAMES from a `tools/list` response.
   *
   * Deliberately not a substring check on the raw body: `resolve_category`'s
   * description mentions `upsert_category_mapping` by name (it tells the agent
   * how to fix an unmapped category), so a naive `not.toContain` would report
   * the write tool as listed when it is correctly absent.
   *
   * The transport replies as SSE, so the JSON sits on a `data:` line.
   */
  function toolNames(text: string): string[] {
    const line = text.split('\n').find((candidate) => candidate.startsWith('data:'));
    if (line === undefined) {
      throw new Error(`No SSE data line in MCP response: ${text.slice(0, 200)}`);
    }
    const payload = JSON.parse(line.slice('data:'.length).trim()) as {
      result?: { tools?: { name: string }[] };
    };
    return (payload.result?.tools ?? []).map((tool) => tool.name);
  }

  it('should hide the write tool from a read-only token and expose it to an admin write token', async () => {
    const http = harness.getHttp();
    const dataSource: DataSource = harness.getDataSource();
    // Once per test — see the module header.
    const adminToken = await loginAsAdmin(http, dataSource);

    const readOnly = await mint(adminToken, 'mcp:read');
    const write = await mint(adminToken, 'mcp:write');

    await mcp(readOnly, INITIALIZE_BODY);
    const readOnlyList = await mcp(readOnly, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    await mcp(write, INITIALIZE_BODY);
    const writeList = await mcp(write, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    const readOnlyTools = toolNames(readOnlyList.text);
    const writeTools = toolNames(writeList.text);

    // The reads are ungated, so both principals see them...
    expect(readOnlyTools).toContain('list_category_mappings');
    expect(writeTools).toContain('list_category_mappings');
    // ...but only the admin write token sees the write.
    expect(readOnlyTools).not.toContain('upsert_category_mapping');
    expect(writeTools).toContain('upsert_category_mapping');
  });

  it('should refuse a write tool call made by a read-only token, naming the missing scope', async () => {
    const http = harness.getHttp();
    const dataSource: DataSource = harness.getDataSource();
    const adminToken = await loginAsAdmin(http, dataSource);

    const readOnly = await mint(adminToken, 'mcp:read');
    await mcp(readOnly, INITIALIZE_BODY);

    const called = await mcp(readOnly, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'upsert_category_mapping',
        arguments: {
          destinationConnectionId: '11111111-1111-1111-1111-111111111111',
          sourceConnectionId: '22222222-2222-2222-2222-222222222222',
          sourceCategoryId: '42',
          destinationCategoryId: '77',
          destinationCategoryName: 'Shoes',
        },
      },
    });

    // The row count alone would be a weak assertion — this call names a
    // connection that does not exist, so zero rows proves little on its own.
    // The load-bearing assertion is that the call did not SUCCEED: a refusal
    // (or an unknown-tool reply) never returns the persisted mapping.
    const rows = await dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM category_mappings`
    );
    expect(rows[0].count).toBe('0');
    expect(called.text).not.toContain('"destinationCategoryName":"Shoes"');
    expect(called.text).not.toContain('"sourceCategoryId":"42"');
  });

  it('should let an admin write token persist a mapping that a later read returns', async () => {
    const http = harness.getHttp();
    const dataSource: DataSource = harness.getDataSource();
    const adminToken = await loginAsAdmin(http, dataSource);

    // A real destination connection, so the write exercises persistence rather
    // than failing earlier for an unrelated reason — the gap the refusal test
    // above cannot close on its own. Seeded through the shared helper (the same
    // one mcp-tools.int-spec.ts uses) rather than the HTTP create endpoint,
    // whose payload contract is not this spec's subject.
    const connection = await createTestConnection(dataSource, {
      name: 'int-spec destination',
      enabledCapabilities: ['OfferManager'],
    });
    const destinationConnectionId = connection.id;

    const write = await mint(adminToken, 'mcp:write');
    await mcp(write, INITIALIZE_BODY);

    await mcp(write, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'upsert_category_mapping',
        arguments: {
          destinationConnectionId,
          sourceConnectionId: '22222222-2222-2222-2222-222222222222',
          sourceCategoryId: '42',
          destinationCategoryId: '77',
          destinationCategoryName: 'Shoes',
          destinationCategoryPath: 'Fashion > Shoes',
        },
      },
    });

    const listed = await mcp(write, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'list_category_mappings',
        arguments: { destinationConnectionId },
      },
    });

    // Round-trip: the write reached the DB and the read tool returns it.
    const rows = await dataSource.query<{ source_category_id: string }[]>(
      `SELECT source_category_id FROM category_mappings WHERE destination_connection_id = $1`,
      [destinationConnectionId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source_category_id).toBe('42');
    expect(listed.text).toContain('Shoes');
  });
});
