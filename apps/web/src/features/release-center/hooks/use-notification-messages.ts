/**
 * The published message notifications, as React state.
 *
 * @module features/release-center/hooks
 */
import { useSyncExternalStore } from 'react';
import {
  getNotificationSnapshot,
  subscribeNotifications,
  type MessageNotification,
} from '../lib/notification-store';

export function useNotificationMessages(): readonly MessageNotification[] {
  return useSyncExternalStore(subscribeNotifications, getNotificationSnapshot, getNotificationSnapshot);
}
