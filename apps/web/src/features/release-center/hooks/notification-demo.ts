/**
 * SIMULATION ONLY (never commit): example messages and one action rule, so the bell,
 * the popup and the standalone tour can be tried on a demo stack.
 *
 * @module features/release-center/hooks
 */
import { useEffect } from 'react';
import { useMessages } from '../../../shared/i18n';
import { connectionIdOf } from '../lib/completed-steps';
import { registerNotificationRule } from '../lib/notification-rules';
import { publishNotification } from '../lib/notification-store';

const HOUR = 3_600_000;

export function useNotificationDemo(active: boolean, userId: string | null): void {
  const demo = useMessages('release-center').demoMessages;

  useEffect(() => {
    if (!active || !userId) return undefined;
    const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
    // Already there when the app opens: in the list, but no ring and no popup.
    publishNotification({ dedupeKey: 'demo-token', silent: true, severity: 'warning', createdAt: ago(2 * HOUR), title: demo.tokenTitle, body: demo.tokenBody, action: { label: demo.tokenAction, to: '/connections' } });
    publishNotification({ dedupeKey: 'demo-fail', silent: true, severity: 'error', createdAt: ago(26 * HOUR), title: demo.failTitle, body: demo.failBody, action: { label: demo.failAction, to: '/jobs-logs' } });
    publishNotification({ dedupeKey: 'demo-tour', silent: true, severity: 'info', createdAt: ago(3 * 24 * HOUR), title: demo.tourTitle, body: demo.tourBody, action: { label: demo.tourAction, tourId: 'first-steps' } });
    publishNotification({ dedupeKey: 'demo-info', silent: true, severity: 'info', createdAt: ago(5 * 24 * HOUR), title: demo.infoTitle, body: demo.infoBody });
    // One that arrives while you use the app: rings the bell and drops the popup.
    const timer = setTimeout(() => {
      publishNotification({
        dedupeKey: `demo-import-${Math.floor(Date.now() / 600_000)}`,
        severity: 'success',
        title: demo.importTitle,
        body: demo.importBody,
        action: { label: demo.importAction, to: '/listings' },
      });
    }, 6000);
    return () => clearTimeout(timer);
  }, [active, userId, demo]);

  // An action creates a message: saving a connection says so, once an hour per connection.
  useEffect(
    () =>
      registerNotificationRule({
        id: 'demo-connection-saved',
        mutationKey: ['connections', 'update'],
        when: (variables) => {
          const id = connectionIdOf(variables, undefined) ?? 'any';
          return {
            dedupeKey: `demo-saved-${id}-${Math.floor(Date.now() / HOUR)}`,
            severity: 'success',
            title: demo.savedTitle,
            body: demo.savedBody,
            action: { label: demo.savedAction, to: '/connections' },
          };
        },
      }),
    [demo]
  );
}
