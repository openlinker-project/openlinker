/**
 * Automation — public barrel (#2358, Wave-2 spec §5)
 *
 * Automation v1: 8 triggers × 6 actions over a closed legality matrix, stored
 * in the shape of the shipped `sales_document_rules` engine (#2161/#2170)
 * rather than a second answer to "how is a rule stored and evaluated". The
 * three declared divergences from that engine are stated on the
 * `AutomationRule` domain entity.
 *
 * **Not a zero-sibling-edge leaf**, unlike `sales-documents` / `order-lifecycle`:
 * this context has a module, repositories, ORM entities and one deliberate
 * sibling VALUE edge — `HoldReason` from `@openlinker/core/order-lifecycle`,
 * which is itself a leaf and therefore cannot close a CJS module-load cycle.
 * It is registered in `CONTEXT_BARRELS` but not in `ZERO_SIBLING_EDGE_LEAVES`,
 * and — following the `returns` precedent — stays off the aggregating root
 * barrel, reachable at `@openlinker/core/automation`.
 *
 * **#2359 has since added** the pure `evaluateAutomationRules` domain service,
 * the declared §5.4 legality matrix (one table, three consumers: the write path
 * here, the composer's option list and the evaluator's own guard) and the
 * `AutomationSubjectFacts` projection it matches against.
 *
 * **#2358 landed STORAGE only.** Named siblings own the rest, and each is
 * named where its seam is: #2360 trigger emission (and the `automation_trigger_firings` writer),
 * #2361 the six action executors, #2362 the at-most-one gate for irreversible
 * actions, #2363 the CRUD/evaluate/fired-log API, #2385 the `automation_runs`
 * write path and the per-step outcome shape.
 *
 * @module libs/core/src/automation
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5
 */
export * from './domain/types/automation-trigger.types';
export * from './domain/types/automation-trigger-config.types';
export * from './domain/types/automation-condition.types';
export * from './domain/types/automation-action.types';
export * from './domain/types/automation-definition-hash.types';
export * from './domain/types/automation-run.types';
export * from './domain/types/automation-legality.types';
export * from './domain/types/automation-evaluation.types';
export * from './domain/types/automation-facts.types';

export * from './domain/domain-services/evaluate-automation-rules';

export * from './domain/entities/automation-rule.entity';
export * from './domain/entities/automation-run.entity';
export * from './domain/entities/automation-trigger-firing.entity';

export * from './domain/ports/automation-rule-repository.port';

export * from './domain/exceptions/automation-rule-conflict.error';
export * from './domain/exceptions/automation-rule-not-found.error';
export * from './domain/exceptions/automation-invalid-condition.error';
export * from './domain/exceptions/automation-invalid-action.error';
export * from './domain/exceptions/automation-invalid-trigger-config.error';
export * from './domain/exceptions/automation-step-count.error';
export * from './domain/exceptions/automation-illegal-pair.error';
export * from './domain/exceptions/automation-illegal-condition-field.error';

export * from './application/types/automation-rule-write.types';
export type { IAutomationRulesService } from './application/interfaces/automation-rules.service.interface';
export { AutomationRulesService } from './application/services/automation-rules.service';

export { AutomationModule } from './automation.module';
export * from './automation.tokens';
