/**
 * What a message's action button does: open a path or start a standalone tour.
 *
 * @module features/release-center
 */
import { requestReleaseTour } from './release-center-requests';
import type { NotificationAction } from './notification-store';

export function runNotificationAction(
  action: NotificationAction,
  navigate: (path: string) => void
): void {
  if (action.tourId) requestReleaseTour({ showcaseId: action.tourId });
  else if (action.to) navigate(action.to);
}
