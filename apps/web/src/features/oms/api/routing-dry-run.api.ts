/**
 * Routing dry-run API client (#2954)
 *
 * One route: `POST /connections/:connectionId/sourcing-rules/dry-run`. The
 * connection id reaches this client from a route param, so it is
 * `encodeURIComponent`-ed. The response is parsed at the boundary.
 *
 * @module apps/web/src/features/oms/api
 */
import { parseRoutingDryRunResult } from './routing-dry-run.schema';
import type { RoutingDryRunRequest, RoutingDryRunResult } from './routing-dry-run.types';

export interface RoutingDryRunApi {
  /** Non-committing: nothing is created, reserved or sent. Admin-only. */
  run: (connectionId: string, body: RoutingDryRunRequest) => Promise<RoutingDryRunResult>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createRoutingDryRunApi(request: ApiRequest): RoutingDryRunApi {
  return {
    async run(connectionId, body): Promise<RoutingDryRunResult> {
      const payload = await request<unknown>(
        `/connections/${encodeURIComponent(connectionId)}/sourcing-rules/dry-run`,
        { method: 'POST', body: JSON.stringify(body) }
      );
      return parseRoutingDryRunResult(payload);
    },
  };
}
