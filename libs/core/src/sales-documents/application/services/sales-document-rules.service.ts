/**
 * Sales-Document Rules Service (#2170, #2186)
 *
 * Owns the write-path conflict guard, threshold-ref validation, and the
 * read-side assembly that feeds the pure `evaluateSalesDocumentRules`. Injects
 * ONLY this concern's own four repository ports — no `IIntegrationsService`,
 * no connection lookup, no capability check. That check (a rule pointing
 * `Invoice → eparagony.pl` must be rejected because eparagony.pl carries no
 * `Invoicing` capability) is deliberately NOT done here: doing so would inject
 * a cross-context token into a concern this repo's architecture doc pins as a
 * zero-outbound-CORE-context-edge leaf. It is done at the API layer instead
 * (`apps/api/src/sales-documents/`), which already has `IIntegrationsService`
 * in scope and wraps this service's `createRule` / `upsertCountryDefault`.
 *
 * @module libs/core/src/sales-documents/application/services
 * @implements {ISalesDocumentRulesService}
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ISalesDocumentRulesService } from '../interfaces/sales-document-rules.service.interface';
import {
  SALES_DOCUMENT_COUNTRY_ACKNOWLEDGMENT_REPOSITORY_TOKEN,
  SALES_DOCUMENT_COUNTRY_DEFAULT_REPOSITORY_TOKEN,
  SALES_DOCUMENT_RULE_REPOSITORY_TOKEN,
  SALES_DOCUMENT_THRESHOLD_REPOSITORY_TOKEN,
} from '../../sales-documents.tokens';
import { SalesDocumentRuleRepositoryPort } from '../../domain/ports/sales-document-rule-repository.port';
import { SalesDocumentCountryDefaultRepositoryPort } from '../../domain/ports/sales-document-country-default-repository.port';
import { SalesDocumentThresholdRepositoryPort } from '../../domain/ports/sales-document-threshold-repository.port';
import { SalesDocumentCountryAcknowledgmentRepositoryPort } from '../../domain/ports/sales-document-country-acknowledgment-repository.port';
import type { SalesDocumentRule } from '../../domain/entities/sales-document-rule.entity';
import type { SalesDocumentCountryDefault } from '../../domain/entities/sales-document-country-default.entity';
import type { SalesDocumentThreshold } from '../../domain/entities/sales-document-threshold.entity';
import type { SalesDocumentCountryAcknowledgment } from '../../domain/entities/sales-document-country-acknowledgment.entity';
import type {
  SalesDocumentCountryDefaultInput,
  SalesDocumentRuleInput,
} from '../../domain/types/sales-document-rule-write.types';
import {
  computeSalesDocumentConditionsHash,
  isSalesDocumentCondition,
} from '../../domain/types/sales-document-condition.types';
import {
  SALES_DOCUMENT_REST_OF_WORLD_COUNTRY,
  type SalesDocumentOrderFacts,
} from '../../domain/types/sales-document-order-facts.types';
import type { SalesDocumentDecision } from '../../domain/types/sales-document-decision.types';
import type { SalesDocumentCountrySummary } from '../../domain/types/sales-document-country-summary.types';
import { evaluateSalesDocumentRules } from '../../domain/domain-services/evaluate-sales-document-rules';
import { SalesDocumentRuleConflictException } from '../../domain/exceptions/sales-document-rule-conflict.exception';
import { SalesDocumentThresholdNotFoundException } from '../../domain/exceptions/sales-document-threshold-not-found.exception';
import { SalesDocumentInvalidConditionException } from '../../domain/exceptions/sales-document-invalid-condition.exception';
import {
  SalesDocumentCountryDefaultNotFoundException,
  SalesDocumentRuleNotFoundException,
} from '../../domain/exceptions/sales-document-rule-not-found.exception';
import { SalesDocumentCountryAlreadyConfiguredException } from '../../domain/exceptions/sales-document-country-already-configured.exception';

/** One country default's contribution to a `SalesDocumentCountrySummary`. */
interface CountryDefaultSlots {
  invoiceDefaultConnectionId: string | null;
  receiptDefaultConnectionId: string | null;
}

function rangesOverlap(
  aFrom: Date,
  aTo: Date | null,
  bFrom: Date,
  bTo: Date | null,
): boolean {
  const aEnd = aTo ?? new Date(8640000000000000); // open-ended = effectively +infinity
  const bEnd = bTo ?? new Date(8640000000000000);
  return aFrom.getTime() <= bEnd.getTime() && bFrom.getTime() <= aEnd.getTime();
}

@Injectable()
export class SalesDocumentRulesService implements ISalesDocumentRulesService {
  constructor(
    @Inject(SALES_DOCUMENT_RULE_REPOSITORY_TOKEN)
    private readonly ruleRepository: SalesDocumentRuleRepositoryPort,
    @Inject(SALES_DOCUMENT_COUNTRY_DEFAULT_REPOSITORY_TOKEN)
    private readonly countryDefaultRepository: SalesDocumentCountryDefaultRepositoryPort,
    @Inject(SALES_DOCUMENT_THRESHOLD_REPOSITORY_TOKEN)
    private readonly thresholdRepository: SalesDocumentThresholdRepositoryPort,
    @Inject(SALES_DOCUMENT_COUNTRY_ACKNOWLEDGMENT_REPOSITORY_TOKEN)
    private readonly acknowledgmentRepository: SalesDocumentCountryAcknowledgmentRepositoryPort,
  ) {}

  async listRules(country: string): Promise<SalesDocumentRule[]> {
    return this.ruleRepository.findByCountry(country);
  }

  async createRule(input: SalesDocumentRuleInput): Promise<SalesDocumentRule> {
    this.assertConditionsWellFormed(input.conditions);
    await this.assertThresholdRefsResolve(input);

    const conditionsHash = computeSalesDocumentConditionsHash(input.conditions);
    await this.assertNoConflict(input.country, conditionsHash, input.effectiveFrom, input.effectiveTo, input.connectionId);

    const rule = await this.ruleRepository.create({ ...input, conditionsHash });
    // A real configuration and a "no document, by design" acknowledgment can
    // never coexist (#2186) — clear only after the write succeeds, so a
    // rejected create (conflict / unresolved threshold ref) never clears a
    // still-accurate acknowledgment. `acknowledgeNoDocument` enforces the
    // same invariant from the OTHER direction (see its own comment).
    await this.clearAcknowledgment(input.country);
    return rule;
  }

  async deleteRule(id: string): Promise<void> {
    const existing = await this.ruleRepository.findById(id);
    if (existing === null) {
      throw new SalesDocumentRuleNotFoundException(id);
    }
    await this.ruleRepository.delete(id);
  }

  async listCountryDefaults(country: string): Promise<SalesDocumentCountryDefault[]> {
    return this.countryDefaultRepository.findByCountry(country);
  }

  async upsertCountryDefault(
    input: SalesDocumentCountryDefaultInput,
  ): Promise<SalesDocumentCountryDefault> {
    const countryDefault = await this.countryDefaultRepository.upsert(input);
    // Same auto-clear rule as `createRule` (#2186) — see its own comment.
    await this.clearAcknowledgment(input.country);
    return countryDefault;
  }

  async deleteCountryDefault(id: string): Promise<void> {
    const existing = await this.countryDefaultRepository.findById(id);
    if (existing === null) {
      throw new SalesDocumentCountryDefaultNotFoundException(id);
    }
    await this.countryDefaultRepository.delete(id);
  }

  async listThresholds(): Promise<SalesDocumentThreshold[]> {
    return this.thresholdRepository.findAll();
  }

  async resolveRouting(order: SalesDocumentOrderFacts, now: Date = new Date()): Promise<SalesDocumentDecision> {
    const [countryRules, countryDefaults, restOfWorldRules, restOfWorldDefaults, thresholds] =
      await Promise.all([
        this.ruleRepository.findByCountry(order.country),
        this.countryDefaultRepository.findByCountry(order.country),
        this.ruleRepository.findByCountry(SALES_DOCUMENT_REST_OF_WORLD_COUNTRY),
        this.countryDefaultRepository.findByCountry(SALES_DOCUMENT_REST_OF_WORLD_COUNTRY),
        this.thresholdRepository.findAll(),
      ]);

    return evaluateSalesDocumentRules({
      order,
      countryRules,
      countryDefaults,
      restOfWorldRules,
      restOfWorldDefaults,
      thresholds,
      now,
    });
  }

  /**
   * Merges rule counts + country defaults + acknowledgments by country
   * (#2186) — a country appearing in ANY of the three sources gets a row; a
   * missing side defaults to `0` / `null` rather than the row being dropped.
   */
  async listConfiguredCountries(): Promise<SalesDocumentCountrySummary[]> {
    const [ruleCounts, defaults, acknowledgments] = await Promise.all([
      this.ruleRepository.countRulesByCountry(),
      this.countryDefaultRepository.findAll(),
      this.acknowledgmentRepository.findAll(),
    ]);

    const defaultSlotsByCountry = new Map<string, CountryDefaultSlots>();
    for (const countryDefault of defaults) {
      const slots =
        defaultSlotsByCountry.get(countryDefault.country) ??
        ({ invoiceDefaultConnectionId: null, receiptDefaultConnectionId: null } satisfies CountryDefaultSlots);
      if (countryDefault.documentKind === 'invoice') {
        slots.invoiceDefaultConnectionId = countryDefault.connectionId;
      } else if (countryDefault.documentKind === 'fiscal-receipt') {
        slots.receiptDefaultConnectionId = countryDefault.connectionId;
      }
      defaultSlotsByCountry.set(countryDefault.country, slots);
    }

    const acknowledgedAtByCountry = new Map<string, Date>();
    for (const acknowledgment of acknowledgments) {
      acknowledgedAtByCountry.set(acknowledgment.country, acknowledgment.acknowledgedAt);
    }

    const countries = new Set<string>([
      ...ruleCounts.keys(),
      ...defaultSlotsByCountry.keys(),
      ...acknowledgedAtByCountry.keys(),
    ]);

    return Array.from(countries).map((country) => {
      const slots = defaultSlotsByCountry.get(country);
      const acknowledgedAt = acknowledgedAtByCountry.get(country);
      return {
        country,
        ruleCount: ruleCounts.get(country) ?? 0,
        invoiceDefaultConnectionId: slots?.invoiceDefaultConnectionId ?? null,
        receiptDefaultConnectionId: slots?.receiptDefaultConnectionId ?? null,
        acknowledgedNoDocumentAt: acknowledgedAt ? acknowledgedAt.toISOString() : null,
      };
    });
  }

  async acknowledgeNoDocument(country: string): Promise<SalesDocumentCountryAcknowledgment> {
    // Mirror-image of the `createRule` / `upsertCountryDefault` auto-clear
    // (#2186): a real configuration and an acknowledgment can never coexist,
    // so this write is rejected outright rather than silently producing that
    // contradictory state when the acknowledgment lands SECOND.
    await this.assertCountryUnconfigured(country);
    return this.acknowledgmentRepository.upsert(country);
  }

  async clearAcknowledgment(country: string): Promise<void> {
    await this.acknowledgmentRepository.delete(country);
  }

  /**
   * Throws `SalesDocumentCountryAlreadyConfiguredException` when `country`
   * already carries any active rule or country default — the guard that
   * keeps `acknowledgeNoDocument` from ever coexisting with a real
   * configuration (#2186).
   */
  private async assertCountryUnconfigured(country: string): Promise<void> {
    const [rules, defaults] = await Promise.all([
      this.ruleRepository.findByCountry(country),
      this.countryDefaultRepository.findByCountry(country),
    ]);
    if (rules.length > 0 || defaults.length > 0) {
      throw new SalesDocumentCountryAlreadyConfiguredException(country);
    }
  }

  /**
   * Defense-in-depth guard (review finding 2): reject any condition that
   * fails {@link isSalesDocumentCondition} BEFORE it can persist. The HTTP DTO
   * layer already validates this shape, but this service has no other caller
   * enforcing it, and a condition that slips through would otherwise persist
   * as an unconditional "match everything" rule — the read-side repository
   * mapper only discovers the same malformation later, by silently filtering
   * it out of an already-saved row.
   */
  private assertConditionsWellFormed(conditions: SalesDocumentRuleInput['conditions']): void {
    for (let i = 0; i < conditions.length; i++) {
      if (!isSalesDocumentCondition(conditions[i])) {
        throw new SalesDocumentInvalidConditionException(i);
      }
    }
  }

  /**
   * Validate every `orderTotalGross` condition's `thresholdRef` resolves
   * BEFORE persisting the rule — an unresolvable ref at evaluation time would
   * silently make the condition unevaluable rather than loudly wrong at
   * authoring time.
   */
  private async assertThresholdRefsResolve(input: SalesDocumentRuleInput): Promise<void> {
    const refs: string[] = [];
    for (const condition of input.conditions) {
      if (condition.field === 'orderTotalGross') {
        refs.push(condition.thresholdRef);
      }
    }
    if (refs.length === 0) return;

    const found = await this.thresholdRepository.findByRefs(refs);
    const foundRefs = new Set(found.map((t) => t.ref));
    for (const ref of refs) {
      if (!foundRefs.has(ref)) {
        throw new SalesDocumentThresholdNotFoundException(ref);
      }
    }
  }

  /**
   * The write-path conflict guard (mockup tab 02): same country + same
   * `conditionsHash` + an OVERLAPPING effective range + a DIFFERENT
   * connection is rejected outright. Deliberately no `priority` field breaks
   * the tie — see `SalesDocumentRuleConflictException`'s own doc comment.
   *
   * NOT a transaction, lock, or `SELECT FOR UPDATE` (review finding 9,
   * correcting an earlier version of this comment that overstated the
   * guarantee as "read-then-reject inside one transaction") — a plain
   * read-then-check, same as ADR-040's own append-only guard, which also
   * ships no database-level guard beyond the exact-duplicate unique index
   * the migration adds. Two concurrent `createRule` calls for the same
   * country with OVERLAPPING-but-not-identical scope can both pass this
   * check and insert; the unique index only catches an exact
   * `(country, conditionsHash, connectionId, effectiveFrom)`-shaped tuple
   * match, not an overlap. The blast radius is bounded, not eliminated: the
   * runtime evaluator (`evaluateSalesDocumentRules`) still fails safe to
   * `unresolved`/`conflicting-rules-equal-priority` on genuine ambiguity
   * rather than silently picking one of the two racily-inserted rules —
   * ADR-041's "never silently pick one" invariant holds regardless. Real
   * locking (an advisory lock keyed on `(country, conditionsHash)`, or a
   * `SELECT ... FOR UPDATE` inside an explicit transaction) is a fast-follow,
   * not shipped here.
   */
  private async assertNoConflict(
    country: string,
    conditionsHash: string,
    effectiveFrom: Date,
    effectiveTo: Date | null,
    connectionId: string,
  ): Promise<void> {
    const candidates = await this.ruleRepository.findByCountryAndConditionsHash(country, conditionsHash);
    for (const candidate of candidates) {
      if (candidate.connectionId === connectionId) continue;
      if (rangesOverlap(effectiveFrom, effectiveTo, candidate.effectiveFrom, candidate.effectiveTo)) {
        throw new SalesDocumentRuleConflictException(candidate.id, candidate.connectionId);
      }
    }
  }
}
