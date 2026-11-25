/**
 * Message notifications: the registry
 *
 * Plain notifications next to the release cards ("Allegro token expires in 3
 * days", "Import finished"). A feature publishes one with `publishNotification`
 * and never imports the bell. The list is kept per signed-in user in this
 * browser (localStorage, keyed by user id), so a message is never shown to another
 * account that signs in on the same machine. Read, archived and deleted are NOT kept
 * here: they are the user's own release-state rows, keyed by the item key, so they
 * follow the user to other devices.
 *
 * Limits, on purpose: a message exists only where it was published (no server copy),
 * so a feature should publish a condition again on every load (the dedupe key makes
 * that a no-op) rather than rely on it surviving. Title and body are stored as the
 * publisher wrote them, so they are not re-translated when the language changes.
 *
 * @module features/release-center
 */
export type NotificationSeverity = 'info' | 'warning' | 'error' | 'success';

export interface NotificationAction {
  label: string;
  /** Router path to open. */
  to?: string;
  /** Id of a showcase (tour-only item) to start. */
  tourId?: string;
}

export interface MessageNotification {
  /** `msg-<dedupe key>`: lower-case, no dots, so it fits the release-state item key rule. */
  itemKey: string;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  action?: NotificationAction;
  createdAt: string;
}

export interface NotificationDraft {
  /** Same key, same message: publishing it again does nothing, even after a reload. */
  dedupeKey: string;
  severity?: NotificationSeverity;
  title: string;
  body?: string;
  action?: NotificationAction;
  createdAt?: string;
  /** True for a message that was already there (restored state): no ring, no popup. */
  silent?: boolean;
}

const STORAGE_PREFIX = 'ol:notifications:v1:';
const MAX_MESSAGES = 50;

let userId: string | null = null;
let messages: readonly MessageNotification[] = [];
const listeners = new Set<() => void>();
const arrivalListeners = new Set<(message: MessageNotification) => void>();

export function messageItemKey(dedupeKey: string): string {
  const clean = dedupeKey.toLowerCase().replace(/[^a-z0-9:-]+/g, '-').replace(/^-+/, '').slice(0, 120);
  return `msg-${clean || 'x'}`;
}

function persist(): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(messages));
  } catch {
    // Private mode or a full quota: the list simply lives for this page only.
  }
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function readStored(id: string): MessageNotification[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is MessageNotification =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as MessageNotification).itemKey === 'string' &&
        typeof (entry as MessageNotification).title === 'string'
    );
  } catch {
    return [];
  }
}

/** Binds the registry to the signed-in user; `null` (signed out) empties it. */
export function bindNotificationsToUser(id: string | null): void {
  if (id === userId) return;
  userId = id;
  messages = id ? readStored(id) : [];
  emit();
}

export function publishNotification(draft: NotificationDraft): void {
  if (!userId) return;
  const itemKey = messageItemKey(draft.dedupeKey);
  if (messages.some((message) => message.itemKey === itemKey)) return;
  const message: MessageNotification = {
    itemKey,
    severity: draft.severity ?? 'info',
    title: draft.title,
    body: draft.body,
    action: draft.action,
    createdAt: draft.createdAt ?? new Date().toISOString(),
  };
  messages = [message, ...messages]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_MESSAGES);
  persist();
  emit();
  if (!draft.silent) arrivalListeners.forEach((listener) => listener(message));
}

export function subscribeNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNotificationSnapshot(): readonly MessageNotification[] {
  return messages;
}

export function onNotificationArrival(listener: (message: MessageNotification) => void): () => void {
  arrivalListeners.add(listener);
  return () => {
    arrivalListeners.delete(listener);
  };
}

/** Test seam. */
export function resetNotificationStore(): void {
  userId = null;
  messages = [];
  listeners.clear();
  arrivalListeners.clear();
}
