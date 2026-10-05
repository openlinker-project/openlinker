/**
 * Subiekt Bridge Reachability Sweep Handler (#3358)
 *
 * Periodically re-probes a Subiekt connection's own `ConnectionTesterPort`
 * (the same seam the "Test connection" button uses — `SubiektConnectionTesterAdapter`
 * hits the bridge's `GET /health`) and error-logs a structured, greppable
 * token when it fails. Before this, a dead/unreachable bridge process
 * produced no connection-status signal of any kind: no alerting
 * infrastructure exists anywhere in the product, `/v1/health/dev-stack`
 * detects the outage but nothing polled it on a schedule, and Subiekt
 * registered no `AuthFailureClassifierPort` to even passively flip the
 * connection to `needs_reauth`. An operator would only discover an outage
 * by manually reading raw `sync_jobs`.
 *
 * Deliberately narrow: no email/Slack/PagerDuty integration is wired,
 * because none exists in the product to hook into — that remains a
 * separate, larger initiative. This closes only the "nothing polls the
 * existing reachability check" half of the gap.
 *
 * A DISABLED connection is skipped, not flagged — an operator who disabled
 * a connection deliberately does not need a sweep telling them it's
 * unreachable, and `IIntegrationsService.getAdapter` throws
 * `ConnectionDisabledException` for one, which this handler treats as a
 * no-op rather than a failure.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type { SyncJobHandler, SyncJobHandlerResult, SyncJob as SyncJobEntity } from '@openlinker/core/sync';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
  ConnectionTesterRegistryService,
  CREDENTIALS_RESOLVER_TOKEN,
} from '@openlinker/core/integrations';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class SubiektBridgeReachabilitySweepHandler implements SyncJobHandler {
  private readonly logger = new Logger(SubiektBridgeReachabilitySweepHandler.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    private readonly connectionTesterRegistry: ConnectionTesterRegistryService,
    @Inject(CREDENTIALS_RESOLVER_TOKEN)
    private readonly credentialsResolver: CredentialsResolverPort
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    let resolved: { connection: Awaited<ReturnType<IIntegrationsService['getAdapter']>>['connection']; metadata: Awaited<ReturnType<IIntegrationsService['getAdapter']>>['metadata'] };
    try {
      resolved = await this.integrationsService.getAdapter(job.connectionId);
    } catch (error) {
      // A disabled/deleted connection is a no-op for this sweep, not a
      // failure — see the class docblock.
      this.logger.debug(
        `Subiekt reachability sweep skipped connection ${job.connectionId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return { outcome: 'ok' };
    }
    const { connection, metadata } = resolved;

    const tester = this.connectionTesterRegistry.get(metadata.adapterKey);
    if (!tester) {
      // Structurally shouldn't happen (Subiekt always registers a tester),
      // but nothing to check is not a sweep failure.
      return { outcome: 'ok' };
    }

    const result = await tester.test(connection, this.credentialsResolver);
    if (!result.success) {
      // Structured, greppable token — the whole point of this sweep.
      this.logger.error(
        `subiekt_bridge_reachability_sweep_failed connection=${connection.id} ` +
          `name="${connection.name}" reason="${result.message ?? 'unknown'}"`
      );
    }

    // Always 'ok' — the sweep itself succeeded whether or not it found a
    // problem, matching every other sweep-shaped job in the repo.
    return { outcome: 'ok' };
  }
}
