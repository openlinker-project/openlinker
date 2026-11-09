/**
 * GiftPromotionsList (#3940, #3935; mockup `gifts-list`)
 *
 * The gift promotions in the order they are checked, as a dense table (a card
 * list on a phone). The order matters only where a promotion says "do not
 * combine with others": it then stops the ones below it, so a one-line note says
 * so instead of a settings page about priorities. Each row says what the
 * promotion gives, what it gave so far and, when OpenLinker paused it by itself,
 * why. Everything an operator does with a row sits in its menu: edit, copy,
 * pause or turn on, move, delete.
 *
 * Moving a row up or down keeps the existing reorder call, which takes the
 * whole new order. There is no drag handle: nothing here can be dragged.
 *
 * @module apps/web/src/features/gifts/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatAmount } from '../../../shared/format/format-amount';
import { formatAbsoluteDate as formatDate } from '../../../shared/format/format-date';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../shared/ui/dropdown-menu';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { Connection } from '../../connections';
import { VariantThumbnail } from '../../products';
import type { GiftRule } from '../api/gifts.types';
import { useVariantSummaries } from '../hooks/use-variant-summaries';
import { movedOrder, ruleStateKey, RULE_STATE_TONE } from '../lib/gift-rule-view';

/** Vertical-ellipsis glyph on the row menu trigger; the accessible name is the aria-label. */
const MENU_GLYPH = '\u22EF';

export interface GiftPromotionsListProps {
  rules: readonly GiftRule[];
  connections: readonly Connection[];
  canWrite: boolean;
  moving: boolean;
  onReorder: (ruleIds: string[]) => void;
  /** Pause (`false`) or turn on (`true`) a saved promotion. */
  onSetActive: (rule: GiftRule, active: boolean) => void;
  onDelete: (rule: GiftRule) => void;
  /** True while a pause, turn-on or delete is in flight. */
  busy: boolean;
}

interface Row {
  rule: GiftRule;
  index: number;
}

export function GiftPromotionsList({
  rules,
  connections,
  canWrite,
  moving,
  onReorder,
  onSetActive,
  onDelete,
  busy,
}: GiftPromotionsListProps): ReactElement {
  const copy = useMessages('gifts');
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<GiftRule | null>(null);
  const ids = rules.map((rule) => rule.id);
  const rows = useMemo<Row[]>(() => rules.map((rule, index) => ({ rule, index })), [rules]);

  const variantIds = rules.flatMap((rule) => [
    rule.gift?.variantId ?? '',
    ...rule.conditions.flatMap((c) => (c.field === 'containsProduct' ? [c.value] : [])),
  ]);
  const summaries = useVariantSummaries(variantIds);
  const nameOf = (variantId: string): string => summaries.get(variantId)?.name ?? variantId;

  const channelsOf = (rule: GiftRule): string => {
    const condition = rule.conditions.find((c) => c.field === 'sourceConnectionIn');
    if (condition === undefined || condition.field !== 'sourceConnectionIn') return copy.list.allChannels;
    return condition.values.map((id) => connections.find((c) => c.id === id)?.name ?? id).join(', ');
  };

  const summaryOf = (rule: GiftRule): string => {
    const parts: string[] = [];
    const amount = rule.conditions.find((c) => c.field === 'orderTotalGross');
    const contains = rule.conditions.find((c) => c.field === 'containsProduct');
    if (amount !== undefined && amount.field === 'orderTotalGross') {
      parts.push(
        interpolate(copy.list.condition.basket, { amount: formatAmount(Number(amount.amount), amount.currency) }),
      );
    }
    if (contains !== undefined && contains.field === 'containsProduct') {
      const product = nameOf(contains.value);
      const perUnit = rule.gift?.perUnit ?? null;
      parts.push(
        perUnit === null
          ? interpolate(copy.list.condition.contains, { product })
          : perUnit.per === 1
            ? interpolate(copy.list.condition.everyUnit, { product })
            : interpolate(copy.list.condition.everyNth, { n: String(perUnit.per), product }),
      );
    }
    parts.push(channelsOf(rule));
    return parts.join(' · ');
  };

  const stateNote = (rule: GiftRule): string | null => {
    const state = ruleStateKey(rule);
    if (state === 'pausedStock') return copy.list.reasonStock;
    if (state === 'pausedLimit') {
      return interpolate(copy.list.reasonLimit, {
        given: String(rule.unitsGiven),
        cap: String(rule.effectiveCap ?? rule.unitsGiven),
      });
    }
    if (state === 'scheduled') return interpolate(copy.list.starts, { date: formatDate(rule.effectiveFrom) });
    if (rule.effectiveTo !== null && state !== 'draft') {
      return interpolate(copy.list.until, { date: formatDate(rule.effectiveTo) });
    }
    return null;
  };

  const givenCell = (rule: GiftRule): ReactElement => {
    const cap = rule.effectiveCap;
    return (
      <span className="gift-given" data-testid={`gift-rule-given-${rule.id}`}>
        <span>
          {cap === null
            ? interpolate(copy.list.givenNoCap, { given: String(rule.unitsGiven) })
            : interpolate(copy.list.givenOfCap, { given: String(rule.unitsGiven), cap: String(cap) })}
        </span>
        {cap !== null && cap > 0 ? (
          <span
            className="gift-given__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={cap}
            aria-valuenow={Math.min(rule.unitsGiven, cap)}
            aria-label={copy.list.colGiven}
          >
            <span
              className="gift-given__fill"
              style={{ width: `${Math.min(100, Math.round((rule.unitsGiven / cap) * 100))}%` }}
            />
          </span>
        ) : null}
      </span>
    );
  };

  const giftCell = (rule: GiftRule): ReactElement => {
    if (rule.gift === null) return <span className="text-muted">-</span>;
    const summary = summaries.get(rule.gift.variantId);
    const name = summary?.name ?? rule.gift.variantId;
    return (
      <span className="gift-product">
        <VariantThumbnail src={summary?.imageSrc} name={name} />
        <span className="gift-product__name">{name}</span>
        <span className="text-muted">{interpolate(copy.list.giftQty, { n: String(rule.gift.quantity) })}</span>
      </span>
    );
  };

  const promotionCell = (rule: GiftRule): ReactElement => (
    <span className="gift-promotion">
      <span className="gift-promotion__title">
        <Link
          to={`/automations/gifts/${encodeURIComponent(rule.id)}`}
          data-testid={`gift-rule-link-${rule.id}`}
        >
          {rule.name}
        </Link>
        {rule.gift?.doNotCombine ? (
          <StatusBadge tone="neutral" compact data-testid={`gift-rule-nostack-${rule.id}`}>
            {copy.list.doNotCombine}
          </StatusBadge>
        ) : null}
      </span>
      <span className="text-muted">{summaryOf(rule)}</span>
    </span>
  );

  const stateCell = (rule: GiftRule): ReactElement => {
    const state = ruleStateKey(rule);
    const note = stateNote(rule);
    return (
      <span className="gift-state">
        <StatusBadge tone={RULE_STATE_TONE[state]} withDot data-testid={`gift-rule-status-${rule.id}`}>
          {copy.status[state]}
        </StatusBadge>
        {note !== null ? (
          <span className="text-muted" data-testid={`gift-rule-reason-${rule.id}`}>
            {note}
          </span>
        ) : null}
      </span>
    );
  };

  const menu = ({ rule }: Row): ReactElement => {
    const state = ruleStateKey(rule);
    const detail = `/automations/gifts/${encodeURIComponent(rule.id)}`;
    const toggle =
      state === 'draft'
        ? { label: copy.list.menu.turnOn, active: true }
        : state === 'active' || state === 'scheduled'
          ? { label: copy.list.menu.pause, active: false }
          : null;
    const toggleBlocked = !canWrite || busy || rule.gift === null;
    const up = movedOrder(ids, rule.id, 'up');
    const down = movedOrder(ids, rule.id, 'down');
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            tone="secondary"
            className="button--sm"
            aria-label={interpolate(copy.list.menu.open, { name: rule.name })}
            data-testid={`gift-rule-menu-${rule.id}`}
          >
            {MENU_GLYPH}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => void navigate(detail)}
            data-testid={`gift-rule-edit-${rule.id}`}
          >
            {copy.list.menu.edit}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canWrite}
            onSelect={() => void navigate(`/automations/gifts/new?copyOf=${encodeURIComponent(rule.id)}`)}
            data-testid={`gift-rule-copy-${rule.id}`}
          >
            {copy.list.menu.copy}
          </DropdownMenuItem>
          {toggle !== null ? (
            <DropdownMenuItem
              disabled={toggleBlocked}
              onSelect={() => onSetActive(rule, toggle.active)}
              data-testid={`gift-rule-toggle-${rule.id}`}
            >
              {toggle.label}
            </DropdownMenuItem>
          ) : null}
          {state === 'pausedLimit' ? (
            <DropdownMenuItem
              disabled={!canWrite}
              onSelect={() => void navigate(detail)}
              data-testid={`gift-rule-resume-${rule.id}`}
            >
              {copy.list.menu.resume}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!canWrite || moving || up === null}
            onSelect={() => {
              if (up !== null) onReorder(up);
            }}
            data-testid={`gift-rule-up-${rule.id}`}
          >
            {copy.list.menu.up}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canWrite || moving || down === null}
            onSelect={() => {
              if (down !== null) onReorder(down);
            }}
            data-testid={`gift-rule-down-${rule.id}`}
          >
            {copy.list.menu.down}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!canWrite || busy}
            onSelect={() => setDeleting(rule)}
            data-testid={`gift-rule-delete-${rule.id}`}
          >
            {copy.list.menu.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'order',
      header: copy.list.colOrder,
      cell: ({ rule, index }) => <span data-testid={`gift-rule-pos-${rule.id}`}>{index + 1}</span>,
    },
    { id: 'promotion', header: copy.list.colPromotion, lines: 2, cell: ({ rule }) => promotionCell(rule) },
    { id: 'gift', header: copy.list.colGift, cell: ({ rule }) => giftCell(rule) },
    { id: 'state', header: copy.list.colState, lines: 2, cell: ({ rule }) => stateCell(rule) },
    { id: 'given', header: copy.list.colGiven, cell: ({ rule }) => givenCell(rule) },
    {
      id: 'actions',
      header: <span className="sr-only">{copy.list.colActions}</span>,
      align: 'right',
      cell: (row) => menu(row),
    },
  ];

  return (
    <div className="gift-list" data-testid="gift-rule-table">
      <p className="text-muted" data-testid="gift-rule-order-note">
        {copy.list.orderNote}
      </p>
      <DataTable
        caption={copy.list.tableLabel}
        columns={columns}
        rows={rows}
        rowKey={({ rule }) => rule.id}
        rowTestId={({ rule }) => `gift-rule-row-${rule.id}`}
        cardView={{
          title: ({ rule }) => (
            <Link to={`/automations/gifts/${encodeURIComponent(rule.id)}`}>{rule.name}</Link>
          ),
          subtitle: ({ rule }) => summaryOf(rule),
          meta: ({ rule }) => stateCell(rule),
          summary: ({ rule }) => (
            <span className="gift-card-summary">
              {giftCell(rule)}
              {givenCell(rule)}
            </span>
          ),
          actions: (row) => menu(row),
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        tone="danger"
        title={interpolate(copy.list.deleteTitle, { name: deleting?.name ?? '' })}
        description={copy.composer.deleteBody}
        confirmLabel={copy.composer.deleteConfirm}
        cancelLabel={copy.composer.deleteKeep}
        isConfirming={busy}
        onConfirm={() => {
          if (deleting !== null) onDelete(deleting);
          setDeleting(null);
        }}
      />
    </div>
  );
}
