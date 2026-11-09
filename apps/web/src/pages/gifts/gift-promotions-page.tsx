/**
 * Gift promotions (#3940, #3935; mockup `gifts-list`)
 *
 * The list of "add a gift" promotions in check order, with four cards on top.
 * A promotion is an automation rule with one step, so it lives under
 * Automations, but it has its own page: the generic composer cannot say "gift
 * with a product" in words an operator uses.
 *
 * @module apps/web/src/pages/gifts
 */
import { useMemo, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMessages } from '../../shared/i18n';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { ReadOnlyLock } from '../../shared/ui/read-only-lock';
import { useToast } from '../../shared/ui/toast-provider';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useConnectionsQuery } from '../../features/connections';
import { useDemoMode } from '../../features/system';
import {
  GiftPromotionsKpis,
  GiftPromotionsList,
  GiftRuleTemplateCards,
  countRules,
  formToWriteInput,
  ruleToForm,
  summariseGiftResults,
  useDeleteGiftRuleMutation,
  useGiftRuleReportQuery,
  useGiftRulesQuery,
  useReorderGiftRulesMutation,
  useSaveGiftRuleMutation,
  type GiftRule,
} from '../../features/gifts';

export function GiftPromotionsPage(): ReactElement {
  const copy = useMessages('gifts');
  const navigate = useNavigate();
  const { showToast } = useToast();
  const rules = useGiftRulesQuery();
  const connections = useConnectionsQuery();
  const report = useGiftRuleReportQuery();
  const reorder = useReorderGiftRulesMutation();
  const save = useSaveGiftRuleMutation();
  const remove = useDeleteGiftRuleMutation();
  const demoMode = useDemoMode();
  const write = useWriteAccess('gifts:write', demoMode);

  const counts = useMemo(() => countRules(rules.data ?? []), [rules.data]);
  const results = useMemo(
    () => (report.data === undefined ? null : summariseGiftResults(report.data.groups, null)),
    [report.data],
  );

  const setActive = (rule: GiftRule, active: boolean): void => {
    save.mutate(
      { ruleId: rule.id, input: formToWriteInput(ruleToForm(rule), active) },
      { onSuccess: () => showToast({ tone: 'success', title: copy.composer.saved, description: '' }) },
    );
  };

  const deleteRule = (rule: GiftRule): void => {
    remove.mutate(rule.id, {
      onSuccess: () => showToast({ tone: 'success', title: copy.composer.deleted, description: '' }),
    });
  };

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

  const writeError = reorder.isError
    ? copy.list.reorderFailed
    : save.isError
      ? `${copy.list.pauseFailed} ${save.error.message}`
      : remove.isError
        ? `${copy.list.deleteFailed} ${remove.error.message}`
        : null;

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
        <>
          <EmptyState title={copy.list.empty} message={`${copy.list.emptyHint} ${copy.list.emptyStart}`} />
          {write.canWrite ? (
            <GiftRuleTemplateCards
              onChoose={(kind) => void navigate(`/automations/gifts/new?type=${kind}`)}
            />
          ) : null}
        </>
      ) : rules.data !== undefined ? (
        <>
          <GiftPromotionsKpis counts={counts} results={results} reportFailed={report.isError} />
          {writeError !== null ? (
            <Alert tone="error" data-testid="gift-rule-reorder-error">
              {writeError}
            </Alert>
          ) : null}
          <GiftPromotionsList
            rules={rules.data}
            connections={connections.data ?? []}
            canWrite={write.canWrite}
            moving={reorder.isPending}
            onReorder={(ids) => reorder.mutate(ids)}
            onSetActive={setActive}
            onDelete={deleteRule}
            busy={save.isPending || remove.isPending}
          />
        </>
      ) : null}
    </PageLayout>
  );
}
