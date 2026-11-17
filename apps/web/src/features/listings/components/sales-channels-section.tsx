/**
 * Sales Channels Section (#3962)
 *
 * The product page's answer to "is this product still on sale anywhere?"
 * once it was deleted at the source. One verdict on top, then one row per
 * listing (marketplace offer or shop product) with the channel's own status,
 * the quantity it reported, the reason when OpenLinker could not stop the
 * sale, and at most one way to fix it. Rows that need action come first.
 *
 * Three states: something still sells (needs action), nothing sells
 * (collapsed, with the channels one click away), and the product came back
 * at the source (OpenLinker put nothing back on sale by itself - the
 * operator picks the channels and puts them back in one action).
 *
 * @module apps/web/src/features/listings/components
 */
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '../../../shared/ui/button';
import { CheckboxCell } from '../../../shared/ui/checkbox-cell';
import { DetailSection } from '../../../shared/ui/detail-section';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { formatAbsoluteDate, formatAbsoluteTime } from '../../../shared/format/format-date';
import { usePlatforms } from '../../../shared/plugins';
import { ApiError } from '../../../shared/api/api-error';
import { useConnectionsQuery, type Connection } from '../../connections';
import { findPlatformDisplayName } from '../../mappings';
import { buildShopProductUrl } from '../../products';
import type { ListingSaleRow, ProductSaleStatusResponse } from '../api/listings.types';
import { useProductSaleStatusQuery } from '../hooks/use-product-sale-status-query';
import { useReleaseSaleHoldsMutation } from '../hooks/use-release-sale-holds-mutation';
import { buildAllegroSellerPanelUrl } from '../lib/allegro-seller-panel-url';
import { CHANNEL_STATUS_LABEL, SALES_CHANNELS_COPY as COPY } from '../lib/sales-channels.copy';

export interface SalesChannelsVariant {
  id: string;
  sku: string | null;
  attributes: Record<string, string> | null;
  isStale: boolean;
}

export interface SalesChannelsSectionProps {
  productId: string;
  variants: readonly SalesChannelsVariant[];
  /** Display name of the source the product comes from, e.g. "PrestaShop". */
  sourceName: string;
  canWrite: boolean;
}

type Mood = 'attention' | 'done' | 'waiting';

interface ChannelInfo {
  name: string;
  platformName: string;
  platformType: string;
  connection: Connection | undefined;
}

const variantLabel = (v: SalesChannelsVariant | undefined): string | null => {
  if (!v?.attributes) return null;
  const entries = Object.entries(v.attributes);
  return entries.length > 0 ? entries.map(([k, val]) => `${k} ${val}`).join(', ') : null;
};

const variantValue = (v: SalesChannelsVariant): string =>
  v.attributes ? Object.values(v.attributes).join(' ') || (v.sku ?? v.id) : (v.sku ?? v.id);

function useChannelInfo(): (connectionId: string) => ChannelInfo {
  const connections = useConnectionsQuery();
  const platforms = usePlatforms();
  return (connectionId) => {
    const connection = connections.data?.find((c) => c.id === connectionId);
    const platformType = connection?.platformType ?? '';
    return {
      connection,
      platformType,
      name: connection?.name ?? connectionId.slice(0, 8),
      platformName: (connection && findPlatformDisplayName(platforms, connection)) ?? platformType,
    };
  };
}

function listingUrl(row: ListingSaleRow, info: ChannelInfo): string | null {
  if (row.entityType === 'Offer') {
    const env = (info.connection?.config as Record<string, unknown> | undefined)?.environment;
    return buildAllegroSellerPanelUrl(info.platformType, typeof env === 'string' ? env : undefined, row.externalId);
  }
  return buildShopProductUrl(
    info.platformType,
    info.connection?.config as Record<string, unknown> | undefined,
    row.externalParentId ?? row.externalId,
  );
}

function ChannelMark({ info }: { info: ChannelInfo }): ReactElement {
  return (
    <span className="sales-channels__mark" data-channel={info.platformType} aria-hidden="true">
      {info.platformName.charAt(0).toUpperCase()}
    </span>
  );
}

function statusOf(row: ListingSaleRow): { label: string; tone: StatusBadgeTone } {
  if (row.state === 'on_sale') return { label: 'On sale', tone: 'error' };
  if (row.state === 'unknown') return { label: 'Not checked yet', tone: 'neutral' };
  if (row.channelStatus && CHANNEL_STATUS_LABEL[row.channelStatus]) {
    return { label: CHANNEL_STATUS_LABEL[row.channelStatus], tone: 'neutral' };
  }
  if (row.hold?.method === 'unpublished') return { label: 'Draft', tone: 'neutral' };
  return { label: 'Out of stock', tone: 'neutral' };
}

function reasonOf(row: ListingSaleRow, info: ChannelInfo): string | null {
  if (row.state !== 'on_sale') return null;
  switch (row.hold?.outcomeReason) {
    case 'stock_sync_off':
      return COPY.reason.stock_sync_off;
    case 'no_stock_write':
      return COPY.reason.no_stock_write(info.platformName);
    case 'error':
      return COPY.reason.error;
    default:
      return COPY.reason.notYet;
  }
}

interface RowProps {
  row: ListingSaleRow;
  info: ChannelInfo;
  detail: string | null;
  canWrite: boolean;
  pick?: ReactNode;
}

function ChannelRow({ row, info, detail, canWrite, pick }: RowProps): ReactElement {
  const status = statusOf(row);
  const reason = reasonOf(row, info);
  const url = listingUrl(row, info);
  const ref = COPY.offerRef(info.platformName, row.entityType, row.externalParentId ?? row.externalId);
  let action: ReactNode = null;
  if (canWrite && row.state === 'on_sale' && row.hold?.outcomeReason === 'stock_sync_off') {
    action = (
      <Link className="button button--secondary" to={`/connections/${row.connectionId}/edit`}>
        {COPY.turnOnStockSync}
      </Link>
    );
  } else if (row.state === 'on_sale' && row.hold?.outcomeReason === 'no_stock_write' && url) {
    action = (
      <a className="sales-channels__link" href={url} target="_blank" rel="noreferrer">
        {COPY.turnOffIn(info.platformName)} <span aria-hidden="true">↗</span>
      </a>
    );
  }
  return (
    <li className={`sales-channels__row sales-channels__row--${row.state}`}>
      {pick ? <span className="sales-channels__pick">{pick}</span> : null}
      <ChannelMark info={info} />
      <span className="sales-channels__who">
        <span className="sales-channels__name">{info.name}</span>
        {url ? (
          <a className="sales-channels__offer" href={url} target="_blank" rel="noreferrer">
            {ref} <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="sales-channels__offer">{ref}</span>
        )}
      </span>
      <span className="sales-channels__state">
        <span className="sales-channels__status">
          <StatusBadge tone={status.tone} withDot compact>
            {status.label}
          </StatusBadge>
          {detail ? <span className="sales-channels__qty">{detail}</span> : null}
        </span>
        {reason ? <span className={`sales-channels__reason sales-channels__reason--${row.state}`}>{reason}</span> : null}
      </span>
      <span className="sales-channels__action">{action}</span>
    </li>
  );
}

function Group({ label, children, count }: { label?: string; count: number; children: ReactNode }): ReactElement | null {
  if (count === 0) return null;
  return (
    <div className="sales-channels__group">
      {label ? (
        <p className="sales-channels__group-label">
          {label} <span className="sales-channels__group-count">{count}</span>
        </p>
      ) : null}
      <ul className="sales-channels__list">{children}</ul>
    </div>
  );
}

function moodOf(status: ProductSaleStatusResponse): Mood {
  if (!status.deletedAtSource) return 'waiting';
  return status.rows.some((r) => r.state === 'on_sale') ? 'attention' : 'done';
}

export function SalesChannelsSection({
  productId,
  variants,
  sourceName,
  canWrite,
}: SalesChannelsSectionProps): ReactElement | null {
  const query = useProductSaleStatusQuery(productId);
  const release = useReleaseSaleHoldsMutation(productId);
  const channelInfo = useChannelInfo();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const status = query.data;

  const heldRows = useMemo(() => (status?.rows ?? []).filter((r) => r.hold), [status]);
  useEffect(() => {
    setPicked(new Set(heldRows.map((r) => r.hold?.id as string)));
  }, [heldRows]);

  if (!status) return null;
  const visible = status.deletedAtSource || heldRows.length > 0;
  if (!visible || status.rows.length === 0) return null;

  const mood = moodOf(status);
  const rows = mood === 'waiting' ? heldRows : status.rows;
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const stale = variants.filter((v) => v.isStale);
  const partial = stale.length > 0 && stale.length < variants.length;
  const subject = partial ? stale.map((v) => variantLabel(v) ?? v.sku).filter(Boolean).join(', ') : null;
  const selling = rows.filter((r) => r.state === 'on_sale').length;
  const checked = status.checkedAt ? COPY.checked(formatAbsoluteTime(status.checkedAt)) : null;

  const detailOf = (row: ListingSaleRow): string | null => {
    if (mood === 'waiting') return row.hold ? COPY.since(formatAbsoluteDate(row.hold.appliedAt)) : null;
    const v = row.internalVariantId ? variantById.get(row.internalVariantId) : undefined;
    const prefix = partial && v ? `${variantValue(v)}, ` : '';
    if (row.quantity !== null) return `${prefix}${COPY.quantity(row.quantity)}`;
    if (row.hold?.method === 'unpublished' && row.hold.outcome === 'applied') return COPY.cannotBeBought;
    if (row.hold?.method === 'stock_zero' && row.hold.outcome === 'applied') return `${prefix}${COPY.quantity(0)}`;
    return prefix ? prefix.replace(/, $/, '') : null;
  };

  const title =
    mood === 'waiting'
      ? COPY.backAtSource(sourceName)
      : mood === 'attention'
        ? COPY.onSale(subject, selling, rows.length)
        : COPY.offSaleEverywhere(rows.length);

  const renderRow = (row: ListingSaleRow, pick?: ReactNode): ReactElement => (
    <ChannelRow
      key={`${row.connectionId}:${row.entityType}:${row.externalId}`}
      row={row}
      info={channelInfo(row.connectionId)}
      detail={detailOf(row)}
      canWrite={canWrite}
      pick={pick}
    />
  );

  const needs = rows.filter((r) => r.state !== 'off_sale');
  const stopped = rows.filter((r) => r.state === 'off_sale');
  const pickedIds = picked ?? new Set<string>();

  return (
    <DetailSection className={`sales-channels sales-channels--${mood}`} aria-labelledby="sales-channels-title">
      <header className="sales-channels__head">
        <div className="sales-channels__head-text">
          <p className="sales-channels__kicker">{COPY.kicker}</p>
          <h2 id="sales-channels-title" className="sales-channels__title">
            {title}
          </h2>
          <p className="sales-channels__facts">
            {partial ? (
              <span className="sales-channels__sizes" aria-label="Variants">
                {variants.map((v) => (
                  <span key={v.id} className={`sales-channels__size${v.isStale ? ' sales-channels__size--gone' : ''}`}>
                    {variantValue(v)}
                  </span>
                ))}
              </span>
            ) : null}
            {mood !== 'waiting' && status.ordersSinceDeletion !== null ? (
              status.ordersSinceDeletion > 0 && status.staleSkus[0] ? (
                <Link
                  className="sales-channels__link sales-channels__link--strong"
                  to={`/orders?search=${encodeURIComponent(status.staleSkus[0])}`}
                >
                  {COPY.ordersSince(status.ordersSinceDeletion)}
                </Link>
              ) : (
                <span>{COPY.ordersSince(status.ordersSinceDeletion)}</span>
              )
            ) : null}
            {partial && mood === 'attention' ? <span>{COPY.sizeNote}</span> : null}
            {checked ? <span className="sales-channels__checked">{checked}</span> : null}
          </p>
        </div>
        {mood === 'done' ? (
          <div className="sales-channels__head-side">
            <span className="sales-channels__stack" aria-hidden="true">
              {rows.map((r) => (
                <ChannelMark key={`${r.connectionId}:${r.externalId}`} info={channelInfo(r.connectionId)} />
              ))}
            </span>
            <button
              type="button"
              className="sales-channels__toggle"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? COPY.hideChannels : COPY.showChannels}
            </button>
          </div>
        ) : null}
      </header>

      {mood === 'waiting' ? (
        <>
          <Group count={rows.length}>
            {rows.map((row) =>
              renderRow(
                row,
                canWrite ? (
                  <CheckboxCell
                    state={pickedIds.has(row.hold?.id as string) ? 'all' : 'none'}
                    onToggle={() =>
                      setPicked((prev) => {
                        const next = new Set(prev ?? []);
                        const id = row.hold?.id as string;
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                    ariaLabel={`Put back on sale on ${channelInfo(row.connectionId).name}`}
                  />
                ) : undefined,
              ),
            )}
          </Group>
          {canWrite ? (
            <footer className="sales-channels__footer">
              <span className="sales-channels__footer-note">
                {release.isError
                  ? release.error instanceof ApiError && release.error.status === 409
                    ? COPY.putBackRefused
                    : COPY.putBackFailed
                  : release.data && release.data.failed.length > 0
                    ? COPY.putBackFailed
                    : COPY.inStockAtSource(sourceName)}
              </span>
              <Button
                tone="primary"
                disabled={pickedIds.size === 0 || release.isPending}
                onClick={() => release.mutate([...pickedIds])}
              >
                {COPY.putBack(pickedIds.size)}
              </Button>
            </footer>
          ) : null}
        </>
      ) : mood === 'done' ? (
        open ? <Group count={rows.length}>{rows.map((r) => renderRow(r))}</Group> : null
      ) : (
        <>
          <Group label={COPY.needsAction} count={needs.length}>
            {needs.map((r) => renderRow(r))}
          </Group>
          <Group label={COPY.stopped} count={stopped.length}>
            {stopped.map((r) => renderRow(r))}
          </Group>
        </>
      )}
    </DetailSection>
  );
}
