/**
 * Sales-Document Rules Service (#2170, #2186)
 *
 * Owns the write-path conflict guard, threshold-ref validation, and the
 * read-side assembly that feeds the pure `evaluateSalesDocumentRules`. Injects
 * ONLY this concern's own four repository ports — no `IIntegrationsService`,
 * no connection lookup, no capability check. That check (a rule pointing an
 * invoice-kind document at a connection must be rejected when that
 * connection's adapter carries no `Invoicing` capability) is deliberately NOT
 * done here: doing so would inject a cross-context token into a concern this
 * repo's architecture doc pins as a zero-outbound-CORE-context-edge leaf. It
 * is done at the API layer instead
 * (`apps/api/src/sales-documents/`), which already has `IIntegrationsService`
 * in scope and wraps this service's `createRule` / `upsertCountryDefault`.
 *
 * @module libs/core/src/sales-documents/application/services
 * @implements {ISalesDocumentRulesService}
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  ISalesDocumentRulesService,
  SalesDocumentRuleOverlapCheckInput,
} from '../interfaces/sales-document-rules.service.interface';
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
  type SalesDocumentCondition,
} from '../../domain/types/sales-document-condition.types';
import {
  SALES_DOCUMENT_REST_OF_WORLD_COUNTRY,
  type SalesDocumentOrderFacts,
} from '../../domain/types/sales-document-order-facts.types';
import type { SalesDocumentDecision } from '../../domain/types/sales-document-decision.types';
import type { SalesDocumentCountrySummary } from '../../domain/types/sales-document-country-summary.types';
import { evaluateSalesDocumentRules } from '../../domain/domain-services/evaluate-sales-document-rules';
import {
  detectSalesDocumentRuleOverlap,
  salesDocumentRuleWindowsOverlap,
} from '../../domain/domain-services/detect-sales-document-rule-overlap';
import type { SalesDocumentRuleOverlapVerdict } from '../../domain/domain-services/detect-sales-document-rule-overlap';
import { SalesDocumentRuleConflictException } from '../../domain/exceptions/sales-document-rule-conflict.exception';
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

  /**
   * ISO-3166-1 alpha-2 is uppercase by definition, and `'*'` (`★ Rest of
   * world`) is unaffected by either operation — the single normalisation
   * point for every country string this service reads or writes (#3176).
   * Without it, a rule authored as `PL` and an order whose delivery address
   * carries `pl` never compare equal: two markets exist for one country, one
   * of them permanently unconfigured and silently holding every order that
   * lands there.
   *
   * Sibling copies of this two-line rule, named so a fifth author finds them
   * rather than writing a sixth (review finding 5): `LocationService`'s own
   * `normaliseCountry` (`libs/core/src/inventory/application/services/`),
   * `normalizeCountryCode`
   * (`libs/integrations/woocommerce/src/infrastructure/provisioners/woocommerce-provisioner.helpers.ts`)
   * and `normalizeCountryIso2`, in the seller-config module of a provider
   * plugin under `apps/web/src/plugins/`. That last one is cited by role
   * rather than by path because this context's neutral-vocabulary sweep is
   * prose-inclusive, so spelling the provider's directory here would make the
   * comment an offender under the very rule it explains. Deliberately NOT
   * a shared helper or a `check-*-mirror.mjs`: the browser bundle cannot
   * import `@openlinker/core` (#591) and a plugin helper must not import a
   * sibling core context, so three of the four could not consume one
   * definition anyway.
   */
  private normaliseCountry(country: string): string {
    return country.trim().toUpperCase();
  }

  /**
   * Fold every `orderCountry` condition's own comparison value to the casing
   * {@link normaliseCountry} writes (#3176, review finding 2).
   *
   * Without this the scope normalisation above INVERTS the defect it fixes
   * rather than closing it: `evaluateSalesDocumentRules` compares
   * `order.country === condition.value` strictly, and `resolveRouting` now
   * always hands it an uppercased `order.country`, so a condition authored as
   * `orderCountry eq 'pl'` could never match anything again.
   *
   * Ordering is load-bearing: this must run BEFORE
   * `computeSalesDocumentConditionsHash`, because the hash is a column of
   * `UQ_sales_document_rules_country_hash_from` — hashing the un-normalised
   * value would let `pl` and `PL` occupy two different uniqueness scopes for
   * one semantically identical rule, and would leave the conflict guard's
   * `findByCountryAndConditionsHash` candidate pool split across the two.
   *
   * Conditions are validated before they reach here, so every `orderCountry`
   * entry is known to carry a string `value`.
   */
  private normaliseConditionCountries(
    conditions: readonly SalesDocumentCondition[],
  ): readonly SalesDocumentCondition[] {
    return conditions.map((condition) =>
      condition.field === 'orderCountry'
        ? { ...condition, value: this.normaliseCountry(condition.value) }
        : condition,
    );
  }

  async listRules(country: string): Promise<SalesDocumentRule[]> {
    return this.ruleRepository.findByCountry(this.normaliseCountry(country));
  }

  async createRule(rawInput: SalesDocumentRuleInput): Promise<SalesDocumentRule> {
    // Validation runs on the RAW conditions, before normalisation, so a
    // malformed entry is still rejected by the defense-in-depth guard rather
    // than reaching `normaliseConditionCountries` with a non-string value.
    this.assertConditionsWellFormed(rawInput.conditions);
    const input = {
      ...rawInput,
      country: this.normaliseCountry(rawInput.country),
      conditions: this.normaliseConditionCountries(rawInput.conditions),
    };
    // `assertThresholdRefsResolve` is gone with #3189 - a condition carries its
    // own amount now, so there is no ref left to resolve.

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

  async getRulesByIds(ids: readonly string[]): Promise<SalesDocumentRule[]> {
    return this.ruleRepository.findByIds(ids);
  }

  async listCountryDefaults(country: string): Promise<SalesDocumentCountryDefault[]> {
    return this.countryDefaultRepository.findByCountry(this.normaliseCountry(country));
  }

  async upsertCountryDefault(
    rawInput: SalesDocumentCountryDefaultInput,
  ): Promise<SalesDocumentCountryDefault> {
    const input = { ...rawInput, country: this.normaliseCountry(rawInput.country) };
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

  async resolveRouting(rawOrder: SalesDocumentOrderFacts, now: Date = new Date()): Promise<SalesDocumentDecision> {
    // Normalised once, here, and threaded through both the lookup and the
    // evaluator (#3176) — `order.country` otherwise reaches a case-sensitive
    // `country = :country` match against rows written under a normalised
    // scope (`createRule` / `upsertCountryDefault`, above), and a lowercase
    // delivery-address country from the source would silently resolve to
    // "no configuration for this country" instead of the real market.
    const order = { ...rawOrder, country: this.normaliseCountry(rawOrder.country) };
    // No threshold read since #3189: an `orderTotalGross` condition carries its
    // own amount and currency, so the engine needs nothing beyond the rules.
    const [countryRules, countryDefaults, restOfWorldRules, restOfWorldDefaults] =
      await Promise.all([
        this.ruleRepository.findByCountry(order.country),
        this.countryDefaultRepository.findByCountry(order.country),
        this.ruleRepository.findByCountry(SALES_DOCUMENT_REST_OF_WORLD_COUNTRY),
        this.countryDefaultRepository.findByCountry(SALES_DOCUMENT_REST_OF_WORLD_COUNTRY),
      ]);

    return evaluateSalesDocumentRules({
      order,
      countryRules,
      countryDefaults,
      restOfWorldRules,
      restOfWorldDefaults,
      now,
    });
  }

  /**
   * Batched {@link resolveRouting} (#2516).
   *
   * Three reads for the whole batch - rules and defaults for every DISTINCT
   * country the batch mentions plus `★ Rest of world`, and the threshold table
   * once - then the same pure `evaluateSalesDocumentRules` per entry. The query
   * count is fixed at three however many orders arrive, which is the property
   * the orders-list projection needs: one `IN (...)` per table, never one
   * round trip per row.
   */
  async resolveRoutingBatch(
    rawOrders: readonly SalesDocumentOrderFacts[],
    now: Date = new Date(),
  ): Promise<SalesDocumentDecision[]> {
    if (rawOrders.length === 0) {
      return [];
    }

    // Same normalisation `resolveRouting` applies, and for the same reason
    // (#3176) — done once per order here rather than at each lookup site.
    const orders = rawOrders.map((order) => ({ ...order, country: this.normaliseCountry(order.country) }));
    const countries = new Set<string>(orders.map((order) => order.country));
    // `★ Rest of world` is always loaded: tier 3 applies to every order whose
    // own country carries no configuration, so leaving it out would answer
    // `no-configuration-for-country` on an install that HAS a rest-of-world
    // rule.
    countries.add(SALES_DOCUMENT_REST_OF_WORLD_COUNTRY);
    const countryList = [...countries];

    const [rules, defaults] = await Promise.all([
      this.ruleRepository.findByCountries(countryList),
      this.countryDefaultRepository.findByCountries(countryList),
    ]);

    const rulesByCountry = groupByCountry(rules);
    const defaultsByCountry = groupByCountry(defaults);
    const restOfWorldRules = rulesByCountry.get(SALES_DOCUMENT_REST_OF_WORLD_COUNTRY) ?? [];
    const restOfWorldDefaults = defaultsByCountry.get(SALES_DOCUMENT_REST_OF_WORLD_COUNTRY) ?? [];

    return orders.map((order) =>
      evaluateSalesDocumentRules({
        order,
        countryRules: rulesByCountry.get(order.country) ?? [],
        countryDefaults: defaultsByCountry.get(order.country) ?? [],
        restOfWorldRules,
        restOfWorldDefaults,
        now,
      }),
    );
  }

  /**
   * Merges rule counts + country defaults + acknowledgments by country
   * (#2186) — a country appearing in ANY of the three sources gets a row; a
   * missing side defaults to `0` / `null` rather than the row being dropped.
   *
   * Every grouping key is normalised on READ (#3176, review finding 3). The
   * write path uppercases going forward and the migration rewrites what it
   * safely can, but the migration deliberately SKIPS a stray-case row that
   * would collide with an uppercase sibling — leaving that row for a human
   * rather than guessing which of two fiscal-routing rows to keep. Grouping by
   * the raw stored value would render that surviving row as a SECOND market
   * card for one country, which is the exact defect this issue reports. Rule
   * counts are SUMMED across the folding set rather than overwritten, so a
   * country holding rules under both casings reports the real total.
   */
  async listConfiguredCountries(): Promise<SalesDocumentCountrySummary[]> {
    const [rawRuleCounts, defaults, acknowledgments] = await Promise.all([
      this.ruleRepository.countRulesByCountry(),
      this.countryDefaultRepository.findAll(),
      this.acknowledgmentRepository.findAll(),
    ]);

    const ruleCounts = new Map<string, number>();
    for (const [country, count] of rawRuleCounts) {
      const key = this.normaliseCountry(country);
      ruleCounts.set(key, (ruleCounts.get(key) ?? 0) + count);
    }

    const defaultSlotsByCountry = new Map<string, CountryDefaultSlots>();
    for (const countryDefault of defaults) {
      const key = this.normaliseCountry(countryDefault.country);
      const slots =
        defaultSlotsByCountry.get(key) ??
        ({ invoiceDefaultConnectionId: null, receiptDefaultConnectionId: null } satisfies CountryDefaultSlots);
      if (countryDefault.documentKind === 'invoice') {
        slots.invoiceDefaultConnectionId = countryDefault.connectionId;
      } else if (countryDefault.documentKind === 'fiscal-receipt') {
        slots.receiptDefaultConnectionId = countryDefault.connectionId;
      }
      defaultSlotsByCountry.set(key, slots);
    }

    const acknowledgedAtByCountry = new Map<string, Date>();
    for (const acknowledgment of acknowledgments) {
      acknowledgedAtByCountry.set(
        this.normaliseCountry(acknowledgment.country),
        acknowledgment.acknowledgedAt,
      );
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
    const normalisedCountry = this.normaliseCountry(country);
    // Mirror-image of the `createRule` / `upsertCountryDefault` auto-clear
    // (#2186): a real configuration and an acknowledgment can never coexist,
    // so this write is rejected outright rather than silently producing that
    // contradictory state when the acknowledgment lands SECOND.
    await this.assertCountryUnconfigured(normalisedCountry);
    return this.acknowledgmentRepository.upsert(normalisedCountry);
  }

  async clearAcknowledgment(country: string): Promise<void> {
    await this.acknowledgmentRepository.delete(this.normaliseCountry(country));
  }

  /**
   * Throws `SalesDocumentCountryAlreadyConfiguredException` when `country`
   * already carries any active rule or country default — the guard that
   * keeps `acknowledgeNoDocument` from ever coexisting with a real
   * configuration (#2186).
   *
   * `country` is expected already-normalised (#3176) — every public caller
   * normalises before reaching here.
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
   * #3190. Reads the country's live rules and asks the pure detector whether
   * the draft could match the same order as any of them.
   *
   * Scoped to the draft's own country ONLY, which is what `findByCountry`
   * gives: two rules in different markets are already disjoint by the engine's
   * own country tiering, so widening the read would spend a scan to rediscover
   * that. `'*'` (Rest of world) is a country value like any other here - a
   * `*` rule and a `PL` rule are separate tiers and never compete.
   */
  async detectRuleOverlap(
    input: SalesDocumentRuleOverlapCheckInput,
  ): Promise<SalesDocumentRuleOverlapVerdict> {
    const existing = await this.ruleRepository.findByCountry(input.country);
    return detectSalesDocumentRuleOverlap(
      {
        conditions: input.conditions,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        excludeRuleId: input.excludeRuleId,
      },
      existing.map((rule) => ({
        id: rule.id,
        connectionId: rule.connectionId,
        documentKind: rule.documentKind,
        conditions: rule.conditions,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
      })),
    );
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
      if (salesDocumentRuleWindowsOverlap(effectiveFrom, effectiveTo, candidate.effectiveFrom, candidate.effectiveTo)) {
        throw new SalesDocumentRuleConflictException(candidate.id, candidate.connectionId);
      }
    }
  }
}

/**
 * Index country-scoped rows by their own `country`, so the batched resolve
 * can slice one shared read per order without re-filtering the whole list.
 */
function groupByCountry<T extends { readonly country: string }>(rows: readonly T[]): Map<string, T[]> {
  const byCountry = new Map<string, T[]>();
  for (const row of rows) {
    const existing = byCountry.get(row.country);
    if (existing === undefined) {
      byCountry.set(row.country, [row]);
    } else {
      existing.push(row);
    }
  }
  return byCountry;
}
