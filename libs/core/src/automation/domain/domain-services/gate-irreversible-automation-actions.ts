/**
 * Irreversible-Action Gate (#2362, Wave-2 spec §5.5 divergence 3)
 *
 * Given every rule that matched one subject, decides which may run. Pure: no
 * I/O, no clock, no injected dependency, no mutation of its arguments — the
 * same contract `evaluateAutomationRules` holds, and for the same reason: the
 * §5.6(a) dry run has to be able to show an operator this verdict without
 * firing anything.
 *
 * **Why a `domain-services/` file rather than a pure-rule addition to
 * `automation-action.types.ts`.** The `engineering-standards.md § pure-rule
 * exception` admits a runtime function beside a type only when it IS the rule
 * for that type — coercing it, normalising it, deriving from it. This decides
 * over a COLLECTION of rules, so it fails clause 2. It belongs beside
 * `evaluateAutomationRules`, not beside `AUTOMATION_ACTION_IS_IRREVERSIBLE`.
 *
 * Three properties are contract.
 *
 * **1. Collision is keyed PER IRREVERSIBLE ACTION KIND, never "any two
 * irreversible rules".** ADR-041's invariant is at most one originating
 * *document*, not at most one irreversible *act*. Issuing a fiscal document
 * (A1) and buying a label (A2) touch different resources and neither
 * duplicates the other, so a rule firing A1 beside a sibling firing A2 is a
 * configuration an operator may legitimately author. Blocking that pair would
 * make this mirror stricter than the invariant it enforces — the failure #2240
 * names ("never let a mirror of a destination gate be stricter than the gate").
 *
 * **2. The partition is computed ONCE over the original matched set, with no
 * cascade.** It is tempting to free an A2 candidate once its rival was blocked
 * on A1 — that rival will not run anyway. That is a winner DERIVED FROM A
 * BLOCK, i.e. silence-and-pick-one through the back door, which ADR-041 §6
 * forbids for exactly this class of action: for a fiscal document a wrong pick
 * is a legal event. Any action kind with two or more candidates blocks every
 * one of them, full stop, and no second iteration runs.
 *
 * **3. Blocking is per RULE, not per step.** A rule's steps run in order and
 * stop at the first failure (#2361), so there is no half-run to grant. A rule
 * blocked on any one of its irreversible actions is blocked entirely, and its
 * colliding set is the union of its rivals across every irreversible action it
 * carries.
 *
 * The reversible actions (A3 relay, A4 email, A5 hold, A6 release) are
 * explicitly NOT conflicts and must never be reported as such: two emails are
 * recoverable, two labels are not.
 *
 * @module libs/core/src/automation/domain/domain-services
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.5, §5.6
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md §3a, §3b, §6
 */
import type { AutomationRule } from '../entities/automation-rule.entity';
import {
  AutomationActionValues,
  isIrreversibleAction,
  type AutomationActionKind,
} from '../types/automation-action.types';
import type {
  AutomationBlockedRule,
  AutomationGateResult,
} from '../types/automation-gate.types';

/**
 * Partition matched rules into those that may run and those the at-most-one
 * rule refuses.
 *
 * Reads `isIrreversibleAction` rather than restating which actions those are —
 * irreversibility is a property OF THE ACTION (#2358), and a second list here
 * is how the two start disagreeing on the money path.
 */
export function gateIrreversibleAutomationActions(
  rules: readonly AutomationRule[],
): AutomationGateResult {
  // Candidates per irreversible action kind, in the caller's order.
  const candidates = new Map<AutomationActionKind, AutomationRule[]>();

  for (const rule of rules) {
    // A rule may name the same action twice across its (max 3) steps; it
    // collides with itself no more than once, so the kinds are de-duplicated.
    const irreversibleKinds = new Set<AutomationActionKind>();
    for (const step of rule.actions) {
      if (isIrreversibleAction(step.action)) irreversibleKinds.add(step.action);
    }
    for (const kind of irreversibleKinds) {
      const existing = candidates.get(kind);
      if (existing) existing.push(rule);
      else candidates.set(kind, [rule]);
    }
  }

  // One pass over the ORIGINAL candidate sets. Nothing below re-reads a
  // decision made above — see property 2.
  const collidingIdsByRule = new Map<string, Set<string>>();
  const collidingActionsByRule = new Map<string, Set<AutomationActionKind>>();

  for (const [kind, kindRules] of candidates) {
    if (kindRules.length < 2) continue;
    const idsInCollision = kindRules.map((rule) => rule.id);
    for (const rule of kindRules) {
      const ids = collidingIdsByRule.get(rule.id) ?? new Set<string>();
      // Includes the rule itself — see `AutomationBlockedRule.collidingRuleIds`.
      for (const id of idsInCollision) ids.add(id);
      collidingIdsByRule.set(rule.id, ids);

      const actions =
        collidingActionsByRule.get(rule.id) ?? new Set<AutomationActionKind>();
      actions.add(kind);
      collidingActionsByRule.set(rule.id, actions);
    }
  }

  if (collidingIdsByRule.size === 0) {
    return { dispatchable: rules, blocked: [] };
  }

  const dispatchable: AutomationRule[] = [];
  const blocked: AutomationBlockedRule[] = [];

  for (const rule of rules) {
    const collidingIds = collidingIdsByRule.get(rule.id);
    if (!collidingIds) {
      dispatchable.push(rule);
      continue;
    }
    blocked.push({
      ruleId: rule.id,
      // The re-scan is for ORDERING, not membership — `collidingIds` already
      // holds the answer. Collapsing this to `[...collidingIds]` would make the
      // persisted array Set-insertion-ordered, i.e. dependent on which rival
      // was seen first, so two runs over the same rules could persist
      // differently-ordered `blockedByRuleIds`. O(n²) over a matched set
      // bounded by rules-per-trigger is the right trade.
      collidingRuleIds: rules.map((r) => r.id).filter((id) => collidingIds.has(id)),
      actions: AutomationActionValues.filter((action) =>
        collidingActionsByRule.get(rule.id)?.has(action),
      ),
    });
  }

  return { dispatchable, blocked };
}
