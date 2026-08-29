/**
 * Trigger labels (#2364)
 *
 * Resolve a trigger identifier to operator words. Separate from the copy module
 * so the lookup tolerates a value the copy table does not carry — a rule saved
 * by a newer build naming a ninth trigger. Such a value renders as its raw
 * identifier rather than as `undefined`: unhelpful, but true, and visibly a
 * value rather than a blank cell.
 *
 * @module apps/web/src/features/automation/lib
 */
import { AUTOMATION_TRIGGER_COPY } from './automation.copy';

export interface TriggerLabel {
  label: string;
  description: string | null;
}

export function describeTrigger(trigger: string): TriggerLabel {
  const entry = (AUTOMATION_TRIGGER_COPY as Record<string, { label: string; description: string }>)[
    trigger
  ];
  return entry ? { ...entry } : { label: trigger, description: null };
}
