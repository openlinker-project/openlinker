/**
 * Runs the registered notification rules on every successful mutation (see
 * `lib/notification-rules`). Mounted once by the release center provider.
 *
 * @module features/release-center/hooks
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { matchingNotificationRules } from '../lib/notification-rules';
import { publishNotification } from '../lib/notification-store';

export function useNotificationRules(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'success') return;
        const key = event.mutation.options.mutationKey;
        if (!key) return;
        for (const rule of matchingNotificationRules(key)) {
          const draft = rule.when(event.mutation.state.variables, event.action.data);
          if (draft) publishNotification(draft);
        }
      }),
    [queryClient]
  );
}
