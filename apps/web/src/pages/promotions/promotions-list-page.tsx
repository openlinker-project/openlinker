/**
 * Promotions list (#3935, mockup `promotions-list`)
 *
 * The promotions in the order they are checked: status tabs, "to check" toggles,
 * search and a joined filter, a table with reorder arrows, an on/off switch and
 * a row menu, and a peek panel. Filters live in the URL. Reordering is offered
 * only while the list shows everything in order; the order shown is the order
 * the server will keep, applied at once and undone if the save fails.
 *
 * @module apps/web/src/pages/promotions
 */
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMessages } from '../../shared/i18n';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { ErrorState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { ReadOnlyLock } from '../../shared/ui/read-only-lock';
import { StatusTabs, type StatusTab } from '../../shared/ui/status-tabs';
import { useGuide } from '../../shared/ui/guide-drawer';
import { useToast } from '../../shared/ui/toast-provider';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useConnectionsQuery } from '../../features/connections';
import { useVariantSummaries } from '../../features/gifts';
import { useDemoMode } from '../../features/system';
import { PromotionPeek } from '../../features/promotions/components/promotion-peek';
import { PromotionsAttention } from '../../features/promotions/components/promotions-attention';
import {
  PromotionsFilterBar,
  type PromotionBenefitFilter,
} from '../../features/promotions/components/promotions-filter-bar';
import { PromotionsGuide } from '../../features/promotions/components/promotions-guide';
import { PromotionsTable } from '../../features/promotions/components/promotions-table';
import {
  useDeletePromotionMutation,
  usePromotionsQuery,
  useReorderPromotionsMutation,
  useSavePromotionMutation,
} from '../../features/promotions/hooks/use-promotions';
import { formToWriteInput, promotionToForm } from '../../features/promotions/lib/promotion-form';
import {
  PromotionAttentionValues,
  PromotionTabValues,
  countPromotions,
  filterPromotions,
  promotionChannelIds,
  type PromotionAttention,
  type PromotionTab,
} from '../../features/promotions/lib/promotion-view';
import type { Promotion } from '../../features/promotions/api/promotions.types';

function readEnum<T extends string>(values: readonly T[], raw: string | null): T | null {
  return raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : null;
}

function GuideButton(): ReactElement {
  const copy = useMessages('promotions').page;
  const openGuide = useGuide();
  return (
    <button
      type="button"
      className="button button--secondary button--sm pm-helpbtn"
      onClick={() => {
        openGuide?.(null);
      }}
      data-testid="promotions-guide-button"
    >
      <span className="pm-qmark" aria-hidden="true">
        ?
      </span>
      {copy.guideButton}
      <span className="button__shortcut" aria-hidden="true">
        ?
      </span>
    </button>
  );
}

export function PromotionsListPage(): ReactElement {
  return (
    <PromotionsGuide>
      <PromotionsListContent />
    </PromotionsGuide>
  );
}

function PromotionsListContent(): ReactElement {
  const copy = useMessages('promotions');
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const demoMode = useDemoMode();
  const write = useWriteAccess('gifts:write', demoMode);
  const promotions = usePromotionsQuery();
  const connections = useConnectionsQuery();
  const reorder = useReorderPromotionsMutation();
  const save = useSavePromotionMutation();
  const remove = useDeletePromotionMutation();
  const [peekId, setPeekId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Promotion | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);

  const tab = readEnum(PromotionTabValues, params.get('tab'));
  const attention = readEnum(PromotionAttentionValues, params.get('attention'));
  const channelId = params.get('channel');
  const benefit = readEnum<PromotionBenefitFilter>(['gift'], params.get('benefit'));
  const query = params.get('q') ?? '';

  const setParam = useCallback(
    (key: string, value: string | null): void => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // The order shown: the server's, unless a move is waiting for its answer.
  const ordered = useMemo(() => {
    const rows = promotions.data ?? [];
    if (localOrder === null) return rows;
    const byId = new Map(rows.map((p) => [p.id, p]));
    const known = localOrder.map((id) => byId.get(id)).filter((p): p is Promotion => p !== undefined);
    return known.length === rows.length ? known : rows;
  }, [promotions.data, localOrder]);

  const summaries = useVariantSummaries(ordered.map((p) => p.benefit.variantId));
  const counts = useMemo(() => countPromotions(ordered), [ordered]);
  const searchText = (p: Promotion): string =>
    `${p.name} ${summaries.get(p.benefit.variantId)?.name ?? ''}`;
  const shown = useMemo(
    () => filterPromotions(ordered, { tab, attention, channelId, query }, searchText),
    // `searchText` only reads `summaries`, which is in the list.
    [ordered, tab, attention, channelId, query, summaries],
  );

  const channels = (connections.data ?? []).filter((c) => c.enabledCapabilities.includes('OrderSource'));
  const channelOptions = channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    count: ordered.filter((p) => {
      const ids = promotionChannelIds(p);
      return ids.length === 0 || ids.includes(channel.id);
    }).length,
  }));
  const filtered = tab !== null || attention !== null || channelId !== null || benefit !== null || query.trim() !== '';
  const canReorder = !filtered;
  const peek = ordered.find((p) => p.id === peekId) ?? null;

  const tabs: StatusTab<PromotionTab>[] = [
    { key: null, label: copy.tabs.all, count: counts.total },
    ...PromotionTabValues.map((key) => ({
      key,
      label: copy.tabs[key],
      count: counts.tabs[key],
    })),
  ];

  const onReorder = (ids: string[]): void => {
    setLocalOrder(ids);
    reorder.mutate(ids, {
      onSettled: () => {
        setLocalOrder(null);
      },
    });
  };

  const onSetActive = (promotion: Promotion, active: boolean): void => {
    save.mutate(
      { id: promotion.id, input: formToWriteInput(promotionToForm(promotion), active) },
      {
        onSuccess: () => {
          showToast({ tone: 'success', title: copy.detail.savedToast, description: '' });
        },
      },
    );
  };

  const clearAll = (): void => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of ['attention', 'channel', 'benefit', 'q']) next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const writeError = reorder.isError
    ? copy.page.reorderFailed
    : save.isError
      ? `${copy.page.writeFailed} ${save.error.message}`
      : remove.isError
        ? `${copy.page.deleteFailed} ${remove.error.message}`
        : null;

  const create = (
    <ReadOnlyLock active={!write.canWrite} message={copy.page.readOnly}>
      <Button
        className="button--sm"
        disabled={!write.canWrite}
        onClick={() => {
          void navigate('/promotions/new');
        }}
        data-testid="promotion-new"
      >
        {copy.page.create}
      </Button>
    </ReadOnlyLock>
  );

  return (
    <PageLayout
      eyebrow={copy.page.eyebrow}
      title={<span data-testid="promotions-title">{copy.page.title}</span>}
      description={copy.page.description}
      actions={
        <span className="pm-actions">
          <GuideButton />
          {write.visible ? create : null}
        </span>
      }
    >
      {!write.canWrite ? (
        <Alert tone="info" data-testid="promotions-readonly-notice">
          {copy.page.readOnly}
        </Alert>
      ) : null}
      {promotions.isLoading ? (
        <DataTableSkeleton columns={[]} label={copy.page.loading} />
      ) : promotions.isError ? (
        <ErrorState title={copy.page.loadFailed} message={promotions.error.message} />
      ) : (
        <>
          <div className="list-statusbar">
            <StatusTabs<PromotionTab>
              tabs={tabs}
              value={tab}
              onChange={(next) => {
                setParam('tab', next);
              }}
              aria-label={copy.tabs.aria}
            />
            <PromotionsAttention
              counts={counts.attention}
              value={attention}
              onChange={(next: PromotionAttention | null) => {
                setParam('attention', next);
              }}
            />
          </div>
          <PromotionsFilterBar
            query={query}
            onQueryChange={(next) => {
              setParam('q', next);
            }}
            channels={channelOptions}
            channelId={channelId}
            onChannelChange={(next) => {
              setParam('channel', next);
            }}
            benefit={benefit}
            benefitCount={ordered.length}
            onBenefitChange={(next) => {
              setParam('benefit', next);
            }}
            resultCount={shown.length}
            onClearAll={clearAll}
          />
          {writeError !== null ? (
            <Alert tone="error" data-testid="promotions-write-error">
              {writeError}
            </Alert>
          ) : null}
          {ordered.length === 0 ? (
            <div className="state-card pm-empty" data-testid="promotions-empty">
              <span className="pm-empty__ico">
                <svg className="pm-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 11h16v9H4z" />
                  <path d="M3 7.5h18V11H3z" />
                  <path d="M12 7.5V20" />
                  <path d="M12 7.5c-2 0-4-1-4-3 2 0 4 1 4 3zm0 0c2 0 4-1 4-3-2 0-4 1-4 3z" />
                </svg>
              </span>
              <div className="state-card__header">
                <h2 className="state-card__title pm-empty__t">{copy.empty.noneTitle}</h2>
                <p className="pm-empty__d">{copy.empty.noneHint}</p>
              </div>
              {write.canWrite ? (
                <div className="state-card__actions">
                  <Button
                    onClick={() => {
                      void navigate('/promotions/new');
                    }}
                  >
                    {copy.page.create}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : shown.length === 0 ? (
            <div className="state-card pm-empty" data-testid="promotions-no-match">
              <div className="state-card__header">
                <h2 className="state-card__title pm-empty__t">{copy.empty.title}</h2>
                <p className="pm-empty__d">{copy.empty.hint}</p>
              </div>
              {write.canWrite ? (
                <div className="state-card__actions">
                  <Button
                    tone="secondary"
                    className="button--sm"
                    onClick={() => {
                      void navigate('/promotions/new');
                    }}
                  >
                    {copy.page.create}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <PromotionsTable
              rows={shown}
              allIds={ordered.map((p) => p.id)}
              connections={connections.data ?? []}
              connectionsLoading={connections.isLoading}
              canWrite={write.canWrite}
              canReorder={canReorder}
              moving={reorder.isPending}
              peekId={peekId}
              onPeek={(promotion) => {
                setPeekId(promotion.id);
              }}
              onReorder={onReorder}
              onSetActive={onSetActive}
              onDuplicate={(promotion) => {
                void navigate(`/promotions/new?copyOf=${encodeURIComponent(promotion.id)}`);
              }}
              onDelete={setPendingDelete}
            />
          )}
        </>
      )}
      <PromotionPeek
        promotion={peek}
        all={ordered}
        connections={connections.data ?? []}
        canWrite={write.canWrite}
        onClose={() => {
          setPeekId(null);
        }}
        onSetActive={onSetActive}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        tone="danger"
        title={copy.detail.deleteTitle}
        description={copy.detail.deleteBody}
        confirmLabel={copy.detail.deleteConfirm}
        cancelLabel={copy.detail.deleteKeep}
        isConfirming={remove.isPending}
        onConfirm={() => {
          if (pendingDelete === null) return;
          remove.mutate(pendingDelete.id, {
            onSuccess: () => {
              setPendingDelete(null);
              if (peekId === pendingDelete.id) setPeekId(null);
              showToast({ tone: 'success', title: copy.detail.deleted, description: '' });
            },
          });
        }}
      />
    </PageLayout>
  );
}
