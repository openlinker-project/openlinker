/**
 * Gift promotions (#3940, mockup M31 `promotions/list`)
 *
 * The list of "add a gift" promotions in check order. A promotion is an
 * automation rule with one step, so it lives under Automations, but it has its
 * own page: the generic composer cannot say "gift with a product" in words an
 * operator uses.
 *
 * @module apps/web/src/pages/gifts
 */
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMessages } from '../../shared/i18n';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { ReadOnlyLock } from '../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useConnectionsQuery } from '../../features/connections';
import { useDemoMode } from '../../features/system';
import {
  GiftPromotionsList,
  useGiftRulesQuery,
  useReorderGiftRulesMutation,
} from '../../features/gifts';

export function GiftPromotionsPage(): ReactElement {
  const copy = useMessages('gifts');
  const navigate = useNavigate();
  const rules = useGiftRulesQuery();
  const connections = useConnectionsQuery();
  const reorder = useReorderGiftRulesMutation();
  const demoMode = useDemoMode();
  const write = useWriteAccess('gifts:write', demoMode);

  const create = (
    <ReadOnlyLock active={!write.canWrite} message={copy.list.readOnly}>
      <Button
        disabled={!write.canWrite}
        onClick={() => void navigate('/automations/gifts/new')}
        data-testid="gift-rule-new"
      >
        {copy.list.create}
      </Button>
    </ReadOnlyLock>
  );

  return (
    <PageLayout
      eyebrow={copy.list.eyebrow}
      title={<span data-testid="gift-rule-title">{copy.list.title}</span>}
      description={copy.list.description}
      actions={write.visible ? create : undefined}
      backTo={{ to: '/automations', label: copy.list.back }}
    >
      {!write.canWrite ? (
        <Alert tone="info" data-testid="gift-rule-readonly-notice">
          {copy.list.readOnly}
        </Alert>
      ) : null}
      {rules.isLoading ? (
        <LoadingState title={copy.list.loading} message="" />
      ) : rules.isError ? (
        <ErrorState title={copy.list.loadFailed} message={rules.error.message} />
      ) : rules.data !== undefined && rules.data.length === 0 ? (
        <EmptyState title={copy.list.empty} message={copy.list.emptyHint} />
      ) : rules.data !== undefined ? (
        <>
          {reorder.isError ? (
            <Alert tone="error" data-testid="gift-rule-reorder-error">
              {copy.list.reorderFailed}
            </Alert>
          ) : null}
          <GiftPromotionsList
            rules={rules.data}
            connections={connections.data ?? []}
            canWrite={write.canWrite}
            moving={reorder.isPending}
            onReorder={(ids) => reorder.mutate(ids)}
          />
        </>
      ) : null}
    </PageLayout>
  );
}
