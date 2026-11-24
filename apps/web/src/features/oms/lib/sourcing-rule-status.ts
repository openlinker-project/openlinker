/**
 * Sourcing-rule display status (#3057)
 *
 * Four states, derived from what the API already reports — there is no status
 * field on the wire, and inventing one server-side would give the same fact two
 * owners.
 *
 * ## `unrecognised` wins over the window, always
 *
 * A rule this build cannot evaluate is invisible to the router whatever its
 * dates say. Reporting it as `Active` because its window is open would be a
 * confident false statement about an order OpenLinker will never apply.
 *
 * ## `scheduled` and `retired` are both real, and are not the same as "off"
 *
 * `effectiveFrom` in the future means the rule is persisted and will start
 * deciding orders on its own; `effectiveTo` in the past means it is kept for
 * history and decides nothing. The backend's default list omits retired rules
 * entirely (`includeSuperseded`), so a `retired` row on screen means the caller
 * asked for history.
 *
 * ## `now` is injected
 *
 * A boundary this close to midnight is exactly the kind of thing a test has to
 * be able to pin, and a module-level `new Date()` cannot be.
 *
 * @module apps/web/src/features/oms/lib
 */
import { getMessages } from '../../../shared/i18n';
import type { SourcingRule } from '../api/sourcing-rules.types';

export const SOURCING_RULE_STATUS_VALUES = [
  'active',
  'scheduled',
  'retired',
  'unrecognised',
] as const;
export type SourcingRuleStatus = (typeof SOURCING_RULE_STATUS_VALUES)[number];

export interface SourcingRuleStatusView {
  status: SourcingRuleStatus;
  label: string;
  /** Maps onto the shared `status-badge--*` tones. `active` renders plain. */
  tone: 'success' | 'info' | 'neutral' | 'warning';
  /** What the state means, for a title attribute. */
  hint: string;
}

const TONES: Readonly<Record<SourcingRuleStatus, SourcingRuleStatusView['tone']>> = {
  active: 'success',
  scheduled: 'info',
  retired: 'neutral',
  unrecognised: 'warning',
};

/** Label and hint read from copy at call time, so they follow the active language. */
function view(status: SourcingRuleStatus): SourcingRuleStatusView {
  const copy = getMessages('oms-core').sourcingRuleStatus;
  return { status, label: copy.labels[status], tone: TONES[status], hint: copy.hints[status] };
}

/**
 * Parse an ISO timestamp to epoch milliseconds, or `null` when it is absent or
 * unreadable — an unparseable bound must not silently become `NaN` and compare
 * false against everything, which would report a retired rule as active.
 */
function toTime(value: string | null): number | null {
  if (value === null) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export function resolveSourcingRuleStatus(
  rule: Pick<SourcingRule, 'recognised' | 'effectiveFrom' | 'effectiveTo'>,
  now: Date = new Date()
): SourcingRuleStatusView {
  if (!rule.recognised) return view('unrecognised');

  const nowTime = now.getTime();
  const from = toTime(rule.effectiveFrom);
  const to = toTime(rule.effectiveTo);

  if (from !== null && from > nowTime) return view('scheduled');
  if (to !== null && to <= nowTime) return view('retired');
  return view('active');
}

/**
 * Whether a rule is one the backend counts as LIVE — the
 * `effectiveTo IS NULL OR effectiveTo > now` slot that the duplicate-detection
 * index guards, and the set `PUT /order` demands be named exhaustively.
 *
 * ## Deliberately NOT derived from the display status
 *
 * Two traps, and the reorder body is wrong in a different direction for each.
 * A SCHEDULED rule already claims its `(kind, name)` slot and is part of the
 * reorder set, so `status === 'active'` would omit it and the server would
 * answer 409 `missingRuleIds`. And `recognised` does not enter the backend's
 * predicate at all, so an unrecognised-AND-retired rule must read NOT live —
 * which a test on the display status cannot say, because `unrecognised` wins
 * over the window there and the rule would be named as an unknown id.
 *
 * So this reads the dates, and only the dates, exactly as the backend does.
 */
export function isLiveSourcingRule(
  rule: Pick<SourcingRule, 'effectiveTo'>,
  now: Date = new Date()
): boolean {
  const to = toTime(rule.effectiveTo);
  return to === null || to > now.getTime();
}
