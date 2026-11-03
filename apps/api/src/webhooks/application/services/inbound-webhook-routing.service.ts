/**
 * Inbound Webhook Routing Service
 *
 * Resolves a verified inbound webhook to a sync-job spec at ingress (#2280) —
 * the translate→resolve step the retired `WebhookToJobHandler` ran
 * asynchronously, now synchronous so the gate transaction knows the
 * jobType/payload/idempotencyKey (ADR-049 decision 1). The capability-
 * translated routing contract (ADR-015) is unchanged; only WHEN it runs moved.
 *
 * Deterministic faults classify as `unroutable` (durable `deadlettered` rows,
 * replacing the Redis DLQ); anything else rethrows so the source retries.
 *
 * Fan-out: a translator may return several canonical events for one delivery
 * (see `WebhookEventTranslatorPort`). Each is resolved through the unchanged
 * policy, and every resolvable one becomes a job in the same gate transaction.
 * The extra jobs' idempotency keys are derived HERE rather than in the policy,
 * so the policy (and its `route()` caller) stays a one-event-one-job function
 * and every single-event plugin produces byte-identical keys.
 *
 * @module apps/api/src/webhooks/application/services
 * @implements {IInboundWebhookRoutingService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { InboundWebhookEvent } from '@openlinker/core/events';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN,
  WebhookEventTranslatorRegistryService,
  IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  ConnectionNotFoundException,
  ConnectionDisabledException,
} from '@openlinker/core/identifier-mapping';
import type { CanonicalInboundEvent } from '@openlinker/core/integrations';
import {
  buildInboundJobIdempotencyKey,
  INBOUND_ROUTING_POLICY_TOKEN,
  IInboundRoutingPolicyService,
} from '@openlinker/core/sync';
import type { SyncJobRequest } from '@openlinker/core/sync';
import { WebhookRoutingUnavailableException } from '../errors/webhook-routing-unavailable.exception';
import type { IInboundWebhookRoutingService } from '../interfaces/inbound-webhook-routing.service.interface';
import type { InboundWebhookRoutingOutcome } from '../types/inbound-webhook-routing.types';

@Injectable()
export class InboundWebhookRoutingService implements IInboundWebhookRoutingService {
  private readonly logger = new Logger(InboundWebhookRoutingService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN)
    private readonly translatorRegistry: WebhookEventTranslatorRegistryService,
    @Inject(INBOUND_ROUTING_POLICY_TOKEN)
    private readonly routingPolicy: IInboundRoutingPolicyService
  ) {}

  async resolveEvent(event: InboundWebhookEvent): Promise<InboundWebhookRoutingOutcome> {
    // Test/verification pings create no job but the delivery is still recorded
    // (status 'received') so the FE can surface "last test.ping at" (#168).
    if (event.eventType.startsWith('test.')) {
      return { kind: 'ping' };
    }

    // Resolve the connection + adapter metadata. A *permanent* config fault
    // dead-letters (a durable row now, not a Redis DLQ entry); any other
    // (transient) error is rethrown TYPED so the source retries (ADR-015
    // invariant 3) and the controller answers 503 rather than letting the
    // message fall through to a 404 a marketplace would read as permanent.
    //
    // Deliberately NO delivery row is written on the transient branch: the row
    // is the ADR-005 dedup gate, so recording one here would make the unique
    // constraint reject the very retry this branch is asking for (#711).
    let resolved;
    try {
      resolved = await this.integrationsService.getAdapter(event.connectionId);
    } catch (resolveError) {
      if (
        resolveError instanceof ConnectionNotFoundException ||
        resolveError instanceof ConnectionDisabledException
      ) {
        return { kind: 'unroutable', reason: `connection-unavailable: ${resolveError.message}` };
      }
      throw new WebhookRoutingUnavailableException(
        event.provider,
        event.connectionId,
        resolveError
      );
    }
    const { connection, metadata } = resolved;

    // Plugin translator by adapterKey — absent means this plugin doesn't
    // decode webhooks (poll-only).
    const translator = this.translatorRegistry.get(metadata.adapterKey);
    if (!translator) {
      return { kind: 'unroutable', reason: `no-translator: ${metadata.adapterKey}` };
    }

    // A translator THROWING is a deterministic fault about this payload, not a
    // transient one — the same payload will throw on every redelivery. Left
    // uncaught it became a permanent 5xx with no durable record anywhere,
    // which is ADR-049's poison-entry gap relocated onto the request path.
    // Dead-lettering it instead makes the event visible and answers 202.
    let translated: CanonicalInboundEvent | readonly CanonicalInboundEvent[] | null;
    try {
      translated = translator.translate(event);
    } catch (translateError) {
      return {
        kind: 'unroutable',
        reason: `translator-threw: ${metadata.adapterKey}: ${
          translateError instanceof Error ? translateError.message : String(translateError)
        }`,
      };
    }
    const canonicals = this.toCanonicalList(translated);
    if (canonicals.length === 0) {
      return {
        kind: 'unroutable',
        reason: `undecodable: objectType=${event.objectType}, eventType=${event.eventType}`,
      };
    }

    const jobs: SyncJobRequest[] = [];
    // job type -> the domain whose event claimed it, so a dropped duplicate can
    // name the event it lost to.
    const routedJobTypes = new Map<string, string>();
    const ungated: string[] = [];
    canonicals.forEach((canonical, index) => {
      const resolution = this.routingPolicy.resolve(
        canonical,
        connection,
        metadata.supportedCapabilities,
        event.eventId
      );
      if (resolution.status === 'ungated') {
        ungated.push(`${canonical.domain} requires ${resolution.requiredCapability}`);
        return;
      }
      // The job type is the discriminator of every non-primary key, so two
      // events routing to the same job type would fold onto one key anyway.
      // Keeping the first makes that explicit instead of leaving it to the
      // unique index to decide inside the transaction. Logged at `warn`, not
      // `debug`: no shipped translator emits two events for one job type, so
      // reaching this branch means a translator is fanning out wrongly and
      // silently losing an event, which should surface without debug logging.
      const claimedBy = routedJobTypes.get(resolution.job.jobType);
      if (claimedBy !== undefined) {
        this.logger.warn(
          `Inbound event ${event.eventId} (connection ${connection.id}, adapter ${metadata.adapterKey}): translated event #${index} (${canonical.domain}) dropped - it routes to ${resolution.job.jobType}, already claimed by the ${claimedBy} event. A translator should emit at most one event per job type.`
        );
        return;
      }
      routedJobTypes.set(resolution.job.jobType, canonical.domain);
      // The key follows the event's POSITION in the translator's list, not its
      // position among the jobs that happened to resolve. If it followed the
      // resolved order, a primary event ungated on the first delivery would
      // hand its base key to a secondary job; once the operator enabled the
      // capability, the redelivered primary would then collide with that
      // secondary job on the unique index and never be created. Positional
      // keys keep each event's key stable whatever the gate says.
      jobs.push(
        index === 0
          ? resolution.job
          : {
              ...resolution.job,
              idempotencyKey: buildInboundJobIdempotencyKey(
                connection.platformType,
                connection.id,
                event.eventId,
                resolution.job.jobType
              ),
            }
      );
    });

    const [primary, ...rest] = jobs;
    if (primary === undefined) {
      return { kind: 'unroutable', reason: `ungated: ${ungated.join('; ')}` };
    }
    if (ungated.length > 0) {
      // Partial routing is still routing: the resolvable changes go ahead and
      // the gated ones are logged, never silently dropped. Dead-lettering the
      // whole delivery instead would hold back work the connection IS allowed
      // to do because of a capability it chose to switch off.
      this.logger.warn(
        `Inbound event ${event.eventId} (connection ${connection.id}) partially routed; ungated: ${ungated.join('; ')}`
      );
    }

    this.logger.debug(
      `Resolved inbound event ${event.eventId} → ${jobs.map((job) => job.jobType).join(', ')}`
    );
    return { kind: 'routed', jobs: [primary, ...rest] };
  }

  /**
   * Normalise the translator's answer to a list. `null` and `[]` both mean
   * "undecodable"; a single event is the one-element list every pre-fan-out
   * plugin still returns.
   */
  private toCanonicalList(
    translated: CanonicalInboundEvent | readonly CanonicalInboundEvent[] | null
  ): readonly CanonicalInboundEvent[] {
    if (translated === null) {
      return [];
    }
    return isCanonicalList(translated) ? translated : [translated];
  }
}

/**
 * `Array.isArray` does not narrow a `readonly` array out of a union in
 * TypeScript's lib typings, so the check is wrapped in a real type guard.
 */
function isCanonicalList(
  translated: CanonicalInboundEvent | readonly CanonicalInboundEvent[]
): translated is readonly CanonicalInboundEvent[] {
  return Array.isArray(translated);
}
