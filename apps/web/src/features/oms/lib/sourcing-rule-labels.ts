/**
 * Sourcing-rule labels (#3057, #3875)
 *
 * Every sentence the table renders about a rule's vocabulary, read from the
 * `oms-core.sourcingRule` copy at call time so it follows the active language.
 *
 * ## Lookups are LOOSE, and that is deliberate
 *
 * The API stores `kind` / `name` / `afterAction` verbatim and reports
 * `recognised: false` for a row this build cannot evaluate. Every accessor here
 * therefore falls back to the RAW value rather than to a generic sentence: an
 * unrecognised rule must degrade to *shown but unlabelled*, never to *silently
 * dropped* or to a confident label for something we do not understand.
 *
 * @module apps/web/src/features/oms/lib
 */
import { getMessages, type Messages, type ResolvedCopy } from '../../../shared/i18n';

type Lookup = Readonly<Record<string, string | undefined>>;

function copy(): ResolvedCopy<Messages['oms-core']>['sourcingRule'] {
  return getMessages('oms-core').sourcingRule;
}

function lookup(table: object, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? (table as Lookup)[key] : undefined;
}

/** Human label for a rule kind, or the raw value when this build has none. */
export function sourcingRuleKindLabel(kind: string): string {
  return lookup(copy().kinds, kind) ?? kind;
}

/** Human label for a rule name, or the raw value when this build has none. */
export function sourcingRuleNameLabel(name: string): string {
  return lookup(copy().names, name) ?? name;
}

/** One-sentence explanation, or `null` when this build has none to give. */
export function sourcingRuleNameHint(name: string): string | null {
  return lookup(copy().nameHints, name) ?? null;
}

export function sourcingRuleKindHint(kind: string): string | null {
  return lookup(copy().kindHints, kind) ?? null;
}

export function sourcingAfterActionLabel(afterAction: string): string {
  return lookup(copy().afterActions, afterAction) ?? afterAction;
}

export function sourcingAfterActionHint(afterAction: string): string | null {
  return lookup(copy().afterActionHints, afterAction) ?? null;
}
