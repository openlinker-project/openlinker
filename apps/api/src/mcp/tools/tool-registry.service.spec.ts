/**
 * McpToolRegistryService Unit Tests
 *
 * Two things are under test, and the second matters more:
 *
 *  1. CAPABILITY GATING — a tool appears iff its capability is backed.
 *  2. THE PER-CALL WRAPPER — the cases hand-written per-tool code gets wrong:
 *     a throwing handler must still release its in-flight slot AND still emit
 *     an audit line; an over-limit call must never reach the handler; and the
 *     raw bearer token must never reach the log.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { IIntegrationsService } from '@openlinker/core/integrations';

import { McpToolRegistryService } from './tool-registry.service';
import { McpAuditLogger } from './audit/mcp-audit.logger';
import type { IMcpRateLimiter, McpRateLimitLease } from './ratelimit/mcp-rate-limiter.interface';
import type { McpToolDefinition } from './tool-definition.types';

const RAW_TOKEN = 'olmcp_super_secret_value';

/** Mirrors what `OlMcpTokenVerifier` puts on the request. */
function authInfo(): { token: string; scopes: string[]; extra: Record<string, unknown> } {
  return {
    // The AuthInfo carries the RAW bearer token — the whole point of the
    // redaction invariant.
    token: RAW_TOKEN,
    scopes: ['mcp:read'],
    extra: {
      mcpTokenId: 'tok-1',
      tokenName: 'laptop',
      olUserId: 'user-1',
      olRole: 'admin',
    },
  };
}

function ctx(): never {
  return { authInfo: authInfo() } as never;
}

/** Captures what the server was asked to register. */
function recordingServer(): {
  server: McpServer;
  names: string[];
  handlers: Map<string, (args: Record<string, unknown>, ctx: unknown) => Promise<unknown>>;
} {
  const names: string[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>, c: unknown) => Promise<unknown>>();
  const server = {
    registerTool: (
      name: string,
      _config: unknown,
      cb: (args: Record<string, unknown>, c: unknown) => Promise<unknown>
    ) => {
      names.push(name);
      handlers.set(name, cb);
    },
  } as unknown as McpServer;
  return { server, names, handlers };
}

function definition(overrides: Partial<McpToolDefinition> = {}): McpToolDefinition {
  return {
    name: 'test_tool',
    requiredCapability: null,
    description: 'test',
    inputSchema: z.object({}),
    handler: () => Promise.resolve({ content: [{ type: 'text' as const, text: 'ok' }] }),
    ...overrides,
  };
}

function integrationsWith(capabilities: readonly string[]): IIntegrationsService {
  return {
    listCapabilityAdapters: ({ capability }: { capability: string }) =>
      Promise.resolve(capabilities.includes(capability) ? [{ connectionId: 'c1' }] : []),
  } as unknown as IIntegrationsService;
}

function allowingLimiter(): IMcpRateLimiter & { released: number } {
  const limiter = {
    released: 0,
    acquire: (): Promise<McpRateLimitLease> =>
      Promise.resolve({
        allowed: true,
        release: () => {
          limiter.released += 1;
          return Promise.resolve();
        },
      }),
  };
  return limiter;
}

function build(
  definitions: readonly McpToolDefinition[],
  integrations: IIntegrationsService,
  limiter: IMcpRateLimiter
): { service: McpToolRegistryService; logged: string[] } {
  const logged: string[] = [];
  const audit = new McpAuditLogger();
  // Capture the emitted line without asserting on the Logger backend.
  jest.spyOn(audit, 'record').mockImplementation((entry) => {
    logged.push(JSON.stringify(entry));
  });
  return {
    service: new McpToolRegistryService(integrations, limiter, audit, definitions),
    logged,
  };
}

describe('McpToolRegistryService', () => {
  describe('capability gating', () => {
    it('should omit every tool of a capability that no connection backs', async () => {
      const { server, names } = recordingServer();
      const { service } = build(
        [
          definition({ name: 'always' }),
          definition({ name: 'gated_a', requiredCapability: 'ProductMaster' }),
          definition({ name: 'gated_b', requiredCapability: 'ProductMaster' }),
        ],
        integrationsWith([]),
        allowingLimiter()
      );

      await service.registerTools(server, ctx());

      expect(names).toEqual(['always']);
    });

    it('should register both tools when one base capability backs two of them', async () => {
      const { server, names } = recordingServer();
      const { service } = build(
        [
          definition({ name: 'gated_a', requiredCapability: 'ProductMaster' }),
          definition({ name: 'gated_b', requiredCapability: 'ProductMaster' }),
        ],
        integrationsWith(['ProductMaster']),
        allowingLimiter()
      );

      await service.registerTools(server, ctx());

      expect(names).toEqual(['gated_a', 'gated_b']);
    });

    it('should resolve capabilities lazily so listing does not construct adapters', async () => {
      const listCapabilityAdapters = jest.fn().mockResolvedValue([{ connectionId: 'c1' }]);
      const { server } = recordingServer();
      const { service } = build(
        [definition({ requiredCapability: 'ProductMaster' })],
        { listCapabilityAdapters } as unknown as IIntegrationsService,
        allowingLimiter()
      );

      await service.registerTools(server, ctx());

      expect(listCapabilityAdapters).toHaveBeenCalledWith({
        capability: 'ProductMaster',
        lazy: true,
      });
    });

    it('should skip a capability that fails to resolve rather than failing the whole list', async () => {
      const { server, names } = recordingServer();
      const { service } = build(
        [definition({ name: 'always' }), definition({ name: 'gated', requiredCapability: 'OrderSource' })],
        {
          listCapabilityAdapters: () => Promise.reject(new Error('connection exploded')),
        } as unknown as IIntegrationsService,
        allowingLimiter()
      );

      await service.registerTools(server, ctx());

      expect(names).toEqual(['always']);
    });
  });

  describe('per-call wrapper', () => {
    it('should release the in-flight slot when the handler throws', async () => {
      const limiter = allowingLimiter();
      const { server, handlers } = recordingServer();
      const { service } = build(
        [definition({ handler: () => Promise.reject(new Error('boom')) })],
        integrationsWith([]),
        limiter
      );
      await service.registerTools(server, ctx());

      await handlers.get('test_tool')?.({}, ctx());

      expect(limiter.released).toBe(1);
    });

    it('should still emit an audit line when the handler throws', async () => {
      const { server, handlers } = recordingServer();
      const { service, logged } = build(
        [definition({ handler: () => Promise.reject(new Error('boom')) })],
        integrationsWith([]),
        allowingLimiter()
      );
      await service.registerTools(server, ctx());

      await handlers.get('test_tool')?.({}, ctx());

      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('"outcome":"error"');
    });

    it('should return an agent-facing tool error rather than propagating the throw', async () => {
      const { server, handlers } = recordingServer();
      const { service } = build(
        [definition({ handler: () => Promise.reject(new Error('boom')) })],
        integrationsWith([]),
        allowingLimiter()
      );
      await service.registerTools(server, ctx());

      const result = (await handlers.get('test_tool')?.({}, ctx())) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('test_tool failed');
    });

    it('should never invoke the handler when the call is over the limit', async () => {
      const handler = jest.fn();
      const { server, handlers } = recordingServer();
      const { service, logged } = build(
        [definition({ handler })],
        integrationsWith([]),
        {
          acquire: () =>
            Promise.resolve({
              allowed: false,
              reason: 'Rate limit exceeded',
              release: () => Promise.resolve(),
            }),
        }
      );
      await service.registerTools(server, ctx());

      const result = (await handlers.get('test_tool')?.({}, ctx())) as { isError?: boolean };

      expect(handler).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(logged[0]).toContain('"outcome":"rate-limited"');
    });

    it('should never write the raw bearer token to the audit log', async () => {
      const { server, handlers } = recordingServer();
      const { service, logged } = build([definition()], integrationsWith([]), allowingLimiter());
      await service.registerTools(server, ctx());

      await handlers.get('test_tool')?.({}, ctx());

      expect(logged).toHaveLength(1);
      expect(logged[0]).not.toContain(RAW_TOKEN);
      expect(logged[0]).toContain('tok-1');
    });

    it('should refuse a call carrying no recognisable principal', async () => {
      const handler = jest.fn();
      const { server, handlers } = recordingServer();
      const { service, logged } = build(
        [definition({ handler })],
        integrationsWith([]),
        allowingLimiter()
      );
      // Register with a principal-less request context — the tools close over
      // the REQUEST-scoped ctx, so that is where its absence must be simulated.
      await service.registerTools(server, {} as never);

      const result = (await handlers.get('test_tool')?.({}, {} as never)) as { isError?: boolean };

      expect(handler).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      // The registry passes `principal: null` down; rendering it as
      // `principal: 'none'` is the logger's job (see its own spec).
      expect(logged[0]).toContain('"principal":null');
    });
  });
});
