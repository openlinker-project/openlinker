/**
 * McpTransportController Unit Tests
 *
 * The point of this suite is the fail-CLOSED guard. The SDK handler performs
 * no verification of its own, so if `requireBearerAuth` ever stops matching
 * this route the handler would serve requests unauthenticated — and the
 * int-spec cannot catch that, because its header-less-request assertion
 * follows the controller to whatever path it moved to.
 */
import type { Request, Response } from 'express';
import type { IAppInfoService } from '../../app-info/app-info.service.interface';
import { McpTransportController } from './mcp-transport.controller';

function buildResponse(): Response & { statusCode?: number; body?: unknown } {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode?: number; body?: unknown };
}

describe('McpTransportController', () => {
  const appInfo = { getProductVersion: () => '1.2.3' } as unknown as IAppInfoService;

  it('should refuse a request that arrives without a principal', async () => {
    const controller = new McpTransportController(appInfo);
    const res = buildResponse();

    await controller.handle({ body: {} } as unknown as Request, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(
      expect.objectContaining({ error: 'invalid_token' })
    );
  });

  it('should not leak the presented token in the refusal body', async () => {
    const controller = new McpTransportController(appInfo);
    const res = buildResponse();

    await controller.handle(
      { body: {}, headers: { authorization: 'Bearer olmcp_secret' } } as unknown as Request,
      res
    );

    expect(JSON.stringify(res.body)).not.toContain('olmcp_secret');
  });
});
