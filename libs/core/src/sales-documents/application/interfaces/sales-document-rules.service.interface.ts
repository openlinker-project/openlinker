/**
 * Sales-Document Rules Service Interface (#2170, #2186)
 *
 * @module libs/core/src/sales-documents/application/interfaces
 */
import type { SalesDocumentRule } from '../../domain/entities/sales-document-rule.entity';
import type { SalesDocumentCountryDefault } from '../../domain/entities/sales-document-country-default.entity';
import type { SalesDocumentThreshold } from '../../domain/entities/sales-document-threshold.entity';
import type { SalesDocumentCountryAcknowledgment } from '../../domain/entities/sales-document-country-acknowledgment.entity';
import type {
  SalesDocumentCountryDefaultInput,
  SalesDocumentRuleInput,
} from '../../domain/types/sales-document-rule-write.types';
import type { SalesDocumentDecision } from '../../domain/types/sales-document-decision.types';
import type { SalesDocumentOrderFacts } from '../../domain/types/sales-document-order-facts.types';
import type { SalesDocumentCountrySummary } from '../../domain/types/sales-document-country-summary.types';

export interface ISalesDocumentRulesService {
  listRules(country: string): Promise<SalesDocumentRule[]>;

  /**
   * Create a rule. Runs the write-path conflict guard (same country + same
   * `conditionsHash` + overlapping effective range + a DIFFERENT connection
   * → `SalesDocumentRuleConflictException`) and validates every referenced
   * `thresholdRef` resolves (`SalesDocumentThresholdNotFoundException`
   * otherwise) before persisting. Auto-clears any existing no-document
   * acknowledgment for `input.country` as part of the same write (#2186) — a
   * real configuration and an acknowledgment can never coexist.
   */
  createRule(input: SalesDocumentRuleInput): Promise<SalesDocumentRule>;

  deleteRule(id: string): Promise<void>;

  listCountryDefaults(country: string): Promise<SalesDocumentCountryDefault[]>;

  /**
   * Auto-clears any existing no-document acknowledgment for `input.country`
   * as part of the same write (#2186) — see `createRule`.
   */
  upsertCountryDefault(
    input: SalesDocumentCountryDefaultInput,
  ): Promise<SalesDocumentCountryDefault>;

  deleteCountryDefault(id: string): Promise<void>;

  listThresholds(): Promise<SalesDocumentThreshold[]>;

  /**
   * Load the order's own country's rules/defaults, `★ Rest of world`'s
   * rules/defaults, and every threshold, then delegate to the pure
   * `evaluateSalesDocumentRules`. `now` defaults to the system clock — pass it
   * explicitly in tests for determinism.
   */
  resolveRouting(order: SalesDocumentOrderFacts, now?: Date): Promise<SalesDocumentDecision>;

  /**
   * Every country carrying any rule, country default, or no-document
   * acknowledgment (#2186) — merged by country, defaulting a missing side to
   * `0` / `null` rather than dropping the row. No pagination — see the
   * issue's own § Assumptions.
   */
  listConfiguredCountries(): Promise<SalesDocumentCountrySummary[]>;

  /**
   * Persist "this market intentionally has no sales document configured".
   * Rejects with `SalesDocumentCountryAlreadyConfiguredException` when the
   * country already carries any active rule or country default (#2186) —
   * the mirror-image of `createRule` / `upsertCountryDefault`'s auto-clear,
   * so a real configuration and an acknowledgment can never coexist from
   * either write direction.
   */
  acknowledgeNoDocument(country: string): Promise<SalesDocumentCountryAcknowledgment>;

  /** Idempotent — clearing an already-unacknowledged country is a no-op. */
  clearAcknowledgment(country: string): Promise<void>;
}
