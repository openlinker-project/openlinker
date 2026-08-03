/**
 * MCP Read-Only Tools Integration Test (#1487)
 *
 * The vertical slice: an authenticated principal calls `tools/list` and gets a
 * capability-declared surface, then calls a tool and gets real data out of
 * OpenLinker's own store.
 *
 * What can only be proven here, not in a unit test:
 *  - the tools are actually reachable over the MCP JSON-RPC transport
 *    (registration, schema serialization, and the SDK's own dispatch);
 *  - the capability gate reflects REAL connection state in the database,
 *    rather than a stubbed `listCapabilityAdapters`;
 *  - the always-registered tools survive a deployment with no connections.
 *
 * `loginAsAdmin` is called at most ONCE per test — it plain-INSERTs a fixed
 * admin user, so a second call in the same test violates the users unique
 * constraint.
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

interface JsonRpcToolsListResult {
  result?: { tools?: Array<{ name: string; description?: string }> };
}

interface JsonRpcCallResult {
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
}

const PROTOCOL_VERSION = '2026-07-28';

describe('MCP Read-Only Tools Integration (#1487)', () => {
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

  async function mintMcpToken(adminToken: string): Promise<string> {
    const response = await harness
      .getHttp()
      .post('/v1/mcp/tokens')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'tools int-spec', scope: 'mcp:read' })
      .expect(201);
    return response.body.rawToken;
  }

  /**
   * Issue one JSON-RPC call against `/mcp` as the given MCP principal.
   *
   * The `_meta` envelope is REQUIRED, not decorative. Protocol revision
   * 2026-07-28 carries the handshake ON EVERY REQUEST — which is precisely
   * what lets OL serve MCP statelessly (a fresh `McpServer` per request, no
   * session, ADR-033). Omitting it yields `-32602 Invalid params`, which
   * surfaces as a bare HTTP 400 that reads like a routing or auth fault
   * rather than a protocol one.
   */
  async function rpc(mcpToken: string, method: string, params: Record<string, unknown> = {}) {
    return harness
      .getHttp()
      .post('/mcp')
      .set('Authorization', `Bearer ${mcpToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', PROTOCOL_VERSION)
      // Revision 2026-07-28 also requires the method — and, for tools/call,
      // the tool name — to be declared in headers that must AGREE with the
      // body. This lets an intermediary route without parsing the JSON-RPC
      // payload; a mismatch or omission is rejected as -32020.
      .set('Mcp-Method', method)
      .set(
        typeof params.name === 'string' ? 'Mcp-Name' : 'X-Unused',
        typeof params.name === 'string' ? params.name : 'unused'
      )
      .send({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
            'io.modelcontextprotocol/clientCapabilities': {},
          },
          ...params,
        },
      });
  }

  /**
   * Seed a connection directly. Going through `POST /connections` would drag in
   * the PrestaShop config-shape validator, which is irrelevant here — this
   * spec's subject is the capability gate, not connection creation.
   */
  async function createConnection(capability: string): Promise<void> {
    await createTestConnection(harness.getDataSource(), {
      name: `int-spec ${capability}`,
      enabledCapabilities: [capability],
    });
  }

  function toolNames(body: JsonRpcToolsListResult): string[] {
    return (body.result?.tools ?? []).map((tool) => tool.name).sort();
  }

  it('should expose only the always-registered tools when no connection backs any capability', async () => {
    const http = harness.getHttp();
    const dataSource: DataSource = harness.getDataSource();
    const adminToken = await loginAsAdmin(http, dataSource);
    const mcpToken = await mintMcpToken(adminToken);

    const response = await rpc(mcpToken, 'tools/list');

    expect(response.status).toBe(200);
    // Discovery must work on an empty deployment — that is the whole point of
    // `whoami` / `list_connections` being ungated.
    //
    // The four mapping reads (#1488) join them for a different but equally
    // deliberate reason: mapping configuration is OL-owned data, not
    // adapter-served, so gating it on a marketplace capability would imply
    // something false about whether the data exists. `upsert_category_mapping`
    // is absent here because this token is read-only, not because of a
    // capability gate — see mcp-mapping-tools.int-spec.ts.
    expect(toolNames(response.body as JsonRpcToolsListResult)).toEqual([
      'list_attribute_mappings',
      'list_category_mappings',
      'list_connections',
      'project_attributes',
      'resolve_category',
      'whoami',
    ]);
  });

  it('should publish the ProductMaster tools once a connection enables that capability', async () => {
    const http = harness.getHttp();
    const dataSource: DataSource = harness.getDataSource();
    const adminToken = await loginAsAdmin(http, dataSource);
    await createConnection('ProductMaster');
    const mcpToken = await mintMcpToken(adminToken);

    const response = await rpc(mcpToken, 'tools/list');

    const names = toolNames(response.body as JsonRpcToolsListResult);
    // One capability backs TWO tools.
    expect(names).toContain('search_catalog');
    expect(names).toContain('get_product');
    // A capability nothing backs stays absent.
    expect(names).not.toContain('get_order');
  });

  it('should return the connection through list_connections without leaking credentials', async () => {
    const http = harness.getHttp();
    const dataSource: DataSource = harness.getDataSource();
    const adminToken = await loginAsAdmin(http, dataSource);
    await createConnection('ProductMaster');
    const mcpToken = await mintMcpToken(adminToken);

    const response = await rpc(mcpToken, 'tools/call', {
      name: 'list_connections',
      arguments: {},
    });

    const body = response.body as JsonRpcCallResult;
    const text = body.result?.content?.[0]?.text ?? '';
    expect(text).toContain('int-spec ProductMaster');
    expect(text).toContain('prestashop');
    // The projection, asserted against a REAL persisted connection.
    expect(text).not.toContain('credentialsRef');
    expect(text).not.toContain('int-spec-key');
    expect(text).not.toContain('shopUrl');
  });

  it('should answer whoami with the OL identity behind the token and never the token itself', async () => {
    const http = harness.getHttp();
    const dataSource: DataSource = harness.getDataSource();
    const adminToken = await loginAsAdmin(http, dataSource);
    const mcpToken = await mintMcpToken(adminToken);

    const response = await rpc(mcpToken, 'tools/call', { name: 'whoami', arguments: {} });

    const text = (response.body as JsonRpcCallResult).result?.content?.[0]?.text ?? '';
    expect(text).toContain('"role"');
    expect(text).toContain('admin');
    expect(text).not.toContain(mcpToken);
  });

  it('should return an empty catalog rather than an error when nothing has synced yet', async () => {
    const http = harness.getHttp();
    const dataSource: DataSource = harness.getDataSource();
    const adminToken = await loginAsAdmin(http, dataSource);
    await createConnection('ProductMaster');
    const mcpToken = await mintMcpToken(adminToken);

    const response = await rpc(mcpToken, 'tools/call', {
      name: 'search_catalog',
      arguments: { query: 'anything' },
    });

    const body = (response.body as JsonRpcCallResult).result;
    // The gate passing does NOT imply data exists — this is the documented
    // consequence of capability-gated registration over an OL-store read.
    expect(body?.isError).toBeFalsy();
    expect(JSON.parse(body?.content?.[0]?.text ?? '{}')).toEqual(
      expect.objectContaining({ total: 0, products: [] })
    );
  });

  it('should reject a tools/call from an unauthenticated caller', async () => {
    const response = await harness
      .getHttp()
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

    expect(response.status).toBe(401);
  });
});
