/**
 * Notification rules: an action creates a message
 *
 * A feature registers `{ mutationKey, when }`; when a mutation with that key
 * succeeds, `when` may return a draft. The release center subscribes to the
 * mutation cache once (see `use-notification-rules`), so the feature never
 * imports the bell, and an action that fails creates nothing.
 *
 * @module features/release-center
 */
import type { NotificationDraft } from './notification-store';

export interface NotificationRule {
  id: string;
  /** Matched as a prefix of the mutation's own key. */
  mutationKey: readonly unknown[];
  when: (variables: unknown, data: unknown) => NotificationDraft | null;
}

const rules = new Map<string, NotificationRule>();

/** Returns an unregister function. A rule with the same id replaces the old one. */
export function registerNotificationRule(rule: NotificationRule): () => void {
  rules.set(rule.id, rule);
  return () => {
    if (rules.get(rule.id) === rule) rules.delete(rule.id);
  };
}

export function matchingNotificationRules(mutationKey: readonly unknown[]): NotificationRule[] {
  return [...rules.values()].filter((rule) =>
    rule.mutationKey.every((part, index) => mutationKey[index] === part)
  );
}
