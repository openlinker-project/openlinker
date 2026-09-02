/**
 * Authority Status Service (#2353, Wave-2 product spec §3/§4)
 *
 * Composes `resolveAuthorities` (#2351) and the inert-state vocabulary (#2352)
 * into the one read the "Who decides what" page makes, plus the preset preview
 * and apply behind it.
 *
 * ## Why this lives in `apps/api` and not in a core context
 *
 * `resolveAuthorities` needs EVERY connection whatever its status and whatever
 * its capabilities — A2/A4/A6 are `config-only`, so any connection may claim
 * them. A core service composing `IIntegrationsService` + the leaf would have to
 * live either IN the leaf (impossible: ADR-053's empty cross-context allow-set
 * is the property that keeps the graph acyclic, since every owning context
 * imports the leaf) or in a fifth trust-shaped context whose only consumer is
 * one page. `RateLimitStatusService` / `WebhookStatusService` are the in-tree
 * precedent for exactly this: an app-layer composition over `ConnectionPort` +
 * `IIntegrationsService`.
 *
 * ## The read model may never gate a write, so apply validates its own result
 *
 * #2351 states the rule this whole read model exists under. `applyPreset`
 * therefore does not consult the CURRENT answers as an authorisation; it
 * computes the resulting configs, resolves THOSE, and refuses on an ambiguity in
 * the result. That is also what makes the refusal reachable in Wave 2 without a
 * preset that assigns: an install already carrying two claimants is refused by
 * every preset including the no-op, which is literally story S1-4.
 *
 * @module apps/api/src/fulfillment-authority/application/services
 * @see docs/plans/implementation-plan-authority-status-api.md
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AUTHORITY_ATTENTION_REASON_DESCRIPTORS,
  attentionReasonForAuthorityQuestion,
  resolveAuthorities,
} from '@openlinker/core/fulfillment-authority';
import type {
  AuthorityAnswerView,
  AuthorityClaimantInput,
} from '@openlinker/core/fulfillment-authority';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IIntegrationsService } from '@openlinker/core/integrations';
import { ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';
import { IOrderRecordService } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../../../integrations/application/interfaces/connection.service.interface';
import {
  AUTHORITY_PRESETS,
  AuthorityPresetIdValues,
  type AuthorityPresetDefinition,
  type AuthorityPresetId,
} from '../authority-presets';
import type { IAuthorityStatusService } from '../interfaces/authority-status.service.interface';
import type {
  AuthorityAttentionItemView,
  AuthorityAttentionView,
  AuthorityPresetChange,
  AuthorityPresetPreview,
  AuthorityPresetView,
  AuthorityStatusView,
} from '../types/authority-status.types';

/** One connection paired with the config a preset would leave on it. */
interface ClaimantSource {
  readonly connection: Connection;
  readonly claimant: AuthorityClaimantInput;
}

@Injectable()
export class AuthorityStatusService implements IAuthorityStatusService {
  private readonly logger = new Logger(AuthorityStatusService.name);

  constructor(
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connectionService: IConnectionService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    // Through IOrderRecordService, never OrderRecordRepositoryPort: a repository
    // port is an INTRA-context contract, so a sibling reads via the published
    // service interface (the #1983 / #2083 precedent). `check-cross-context-imports`
    // enforces it.
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService
  ) {}

  async getStatus(): Promise<AuthorityStatusView> {
    const sources = await this.loadClaimants();
    const rows = resolveAuthorities({ claimants: sources.map((source) => source.claimant) });
    const affectedOrderCount = await this.orderRecordService.countOrdersWithOmsAttention();
    return {
      rows,
      attention: AuthorityStatusService.buildAttention(rows, affectedOrderCount),
      presets: AuthorityStatusService.buildPresets(),
    };
  }

  async previewPreset(presetId: AuthorityPresetId): Promise<AuthorityPresetPreview> {
    const preset = this.requireAvailable(presetId);
    const sources = await this.loadClaimants();
    const before = resolveAuthorities({ claimants: sources.map((source) => source.claimant) });

    // The mutation is pure and returns a NEW object, so `sources` — and through
    // it the live `Connection` instances — are untouched. Nothing here writes.
    const proposed = AuthorityStatusService.applyMutation(sources, preset.mutate);
    const after = resolveAuthorities({ claimants: proposed.map((entry) => entry.claimant) });

    const changes: AuthorityPresetChange[] = [];
    for (let index = 0; index < before.length; index += 1) {
      if (!AuthorityStatusService.sameAnswer(before[index], after[index])) {
        changes.push({ question: before[index].question, before: before[index], after: after[index] });
      }
    }

    const resultingAmbiguities = AuthorityStatusService.deriveAmbiguities(after);
    return {
      presetId,
      changes,
      resultingAmbiguities,
      blocked: resultingAmbiguities.length > 0,
    };
  }

  async applyPreset(presetId: AuthorityPresetId): Promise<AuthorityStatusView> {
    const preset = this.requireAvailable(presetId);
    const sources = await this.loadClaimants();
    const proposed = AuthorityStatusService.applyMutation(sources, preset.mutate);
    const after = resolveAuthorities({ claimants: proposed.map((entry) => entry.claimant) });

    // The guard is over the RESULT, never over the delta — see the class docblock.
    const ambiguities = AuthorityStatusService.deriveAmbiguities(after);
    if (ambiguities.length > 0) {
      throw new UnprocessableEntityException({
        message:
          'Applying this arrangement would leave OpenLinker unable to tell which system decides. ' +
          'Nothing was changed.',
        presetId,
        ambiguities,
      });
    }

    // The write is N independent full-row saves across what may be several
    // plugins' config-shape validators, so it cannot be made atomic here. A
    // failure part-way through therefore leaves the install in a state matching
    // no preset — recoverable only because the mutation is idempotent and a
    // re-submit converges. That is reported rather than papered over: a bare
    // throw on connection 3 of 5 would hand the operator a 500 with two
    // connections already changed and no way to tell which.
    const updatedConnectionIds: string[] = [];
    const failedConnectionIds: string[] = [];
    for (const entry of proposed) {
      // Reference identity: a preset that changed nothing on this connection
      // returns the very same config object, so an unchanged connection is never
      // written and never has its `updatedAt` bumped.
      if (entry.config === entry.source.connection.config) {
        continue;
      }
      const connectionId = entry.source.connection.id;
      try {
        // Through IConnectionService, not ConnectionPort: the service is where
        // per-plugin config-shape validation, adapterKey immutability and the
        // taxonomy bootstrap live, and the port would bypass all three.
        await this.connectionService.update(connectionId, { config: entry.config });
        updatedConnectionIds.push(connectionId);
      } catch (error) {
        failedConnectionIds.push(connectionId);
        this.logger.error(
          `Applying preset ${presetId} failed for connection ${connectionId}; the arrangement is ` +
            `partially applied and re-submitting the same preset will converge: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Re-read rather than returning the in-memory `after`: the response must
    // report what was PERSISTED, which after a partial failure is not what was
    // proposed. The second claimant load is the price of that honesty.
    const status = await this.getStatus();
    return { ...status, applied: { updatedConnectionIds, failedConnectionIds } };
  }

  private requireAvailable(presetId: AuthorityPresetId): AuthorityPresetDefinition {
    const preset = AUTHORITY_PRESETS[presetId];
    if (!preset.available) {
      throw new BadRequestException({
        message: `Preset ${presetId} is not available on this installation.`,
        presetId,
        unavailableReason: preset.unavailableReason,
      });
    }
    return preset;
  }

  /**
   * Every connection, whatever its status.
   *
   * **`isActive` is REPORTED, never filtered upstream.** An `active`-only read is
   * the `analytics-trust` trap: it silently drops exactly the connections the
   * surface exists to explain, and here it would hide the disabled connection
   * whose lingering claim an operator is trying to understand.
   *
   * `resolveAdapterMetadata` is a metadata-only lookup, so it constructs no
   * adapter and resolves no credentials — which is also why it works for a
   * `disabled` connection where `getAdapter` throws.
   */
  // Sequential rather than `Promise.all`: `resolveAdapterMetadata` is a registry
  // lookup, not I/O, and the connection count is single-digit for this persona.
  private async loadClaimants(): Promise<ClaimantSource[]> {
    // No status filter: see the docblock.
    const connections = await this.connectionService.list();
    const sources: ClaimantSource[] = [];
    for (const connection of connections) {
      sources.push({
        connection,
        claimant: {
          connectionId: connection.id,
          isActive: connection.status === 'active',
          supportedCapabilities: await this.resolveSupportedCapabilities(connection),
          enabledCapabilities: connection.enabledCapabilities,
          config: connection.config,
        },
      });
    }
    return sources;
  }

  /**
   * What the adapter manifest advertises, or `[]` when it cannot be resolved.
   *
   * Degrading rather than dropping the connection is deliberate: a `config-only`
   * authority (A2/A4/A6) does not consult this list at all, so an unregistered
   * adapter would otherwise silently lose an A2 claimant and make the page report
   * a default where a claim exists.
   */
  private async resolveSupportedCapabilities(connection: Connection): Promise<readonly string[]> {
    try {
      const metadata = await this.integrationsService.resolveAdapterMetadata({
        platformType: connection.platformType,
        adapterKey: connection.adapterKey,
      });
      return metadata.supportedCapabilities;
    } catch (error) {
      this.logger.warn(
        `Could not resolve adapter metadata for connection ${connection.id}; treating it as ` +
          `advertising no capabilities: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  private static applyMutation(
    sources: readonly ClaimantSource[],
    mutate: (config: Connection['config']) => Connection['config']
  ): Array<{ source: ClaimantSource; config: Connection['config']; claimant: AuthorityClaimantInput }> {
    return sources.map((source) => {
      const config = mutate(source.connection.config);
      return { source, config, claimant: { ...source.claimant, config } };
    });
  }

  /**
   * Are two resolutions of one question the same ANSWER?
   *
   * Structural, over the whole row rather than over `answer` alone: `why`
   * switches arm when a row goes ambiguous and `state` is what the badge reads,
   * so a row whose badge changes is a change the operator must be shown even if
   * the holder list is unchanged. `JSON.stringify` is exact here because every
   * field of `AuthorityAnswerView` is a string, a string array or a plain object
   * literal built in a fixed key order by one producer.
   */
  private static sameAnswer(before: AuthorityAnswerView, after: AuthorityAnswerView): boolean {
    return JSON.stringify(before) === JSON.stringify(after);
  }

  /**
   * The derived half of the attention list.
   *
   * A row that resolves `ambiguous` IS a §4.2 inert state, and which one is
   * `attentionReasonForAuthorityQuestion`'s answer — owned in the leaf so the
   * settings page and the row badges cannot each restate a question→state rule.
   */
  private static deriveAmbiguities(
    rows: readonly AuthorityAnswerView[]
  ): AuthorityAttentionItemView[] {
    const items: AuthorityAttentionItemView[] = [];
    for (const row of rows) {
      if (row.state !== 'ambiguous') {
        continue;
      }
      const reason = attentionReasonForAuthorityQuestion(row.question);
      if (reason === null) {
        continue;
      }
      const descriptor = AUTHORITY_ATTENTION_REASON_DESCRIPTORS[reason];
      items.push({
        reason,
        badge: descriptor.badge,
        surfaces: descriptor.surfaces,
        origin: descriptor.origin,
        question: row.question,
        connectionIds:
          row.answer.kind === 'cannot-tell' ? row.answer.candidateConnectionIds : [],
      });
    }
    return items;
  }

  private static buildAttention(
    rows: readonly AuthorityAnswerView[],
    affectedOrderCount: number
  ): AuthorityAttentionView {
    const derived = AuthorityStatusService.deriveAmbiguities(rows);
    return {
      counted: derived.filter(
        (item) => AUTHORITY_ATTENTION_REASON_DESCRIPTORS[item.reason].counted
      ),
      routine: derived.filter(
        (item) => !AUTHORITY_ATTENTION_REASON_DESCRIPTORS[item.reason].counted
      ),
      affectedOrderCount,
    };
  }

  private static buildPresets(): readonly AuthorityPresetView[] {
    return AuthorityPresetIdValues.map((id) => ({
      id,
      available: AUTHORITY_PRESETS[id].available,
      unavailableReason: AUTHORITY_PRESETS[id].unavailableReason,
    }));
  }
}
