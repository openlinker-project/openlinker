/**
 * Stock variant drawer (#3569, mockup m25)
 *
 * The expanded half of one variant row: where the figure comes from, the
 * "master - held = available to promise" arithmetic, the orders holding units,
 * the positions when stock sits in more than one place, and what each channel
 * will publish against what it was last seen showing.
 *
 * @module apps/web/src/features/inventory/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import type { StockChannelsStatus, StockViewVariant } from '../api/inventory.types';
import {
  describeChannelRule,
  formatStaleness,
  holdLabel,
  isMultiLocation,
  publishedHolds,
  recordedOnlyHolds,
} from '../lib/stock-view';

export type StockRowState = 'ok' | 'unknown' | 'staled';

interface StockVariantDrawerProps {
  rowKey: string;
  variantId: string;
  state: StockRowState;
  stock: StockViewVariant;
  channelsStatus: StockChannelsStatus;
}

function MetaCell({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="variant-drawer__meta-cell">
      <span className="variant-drawer__meta-label">{label}</span>
      <span className="variant-drawer__meta-value variant-drawer__meta-value--wrap">{children}</span>
    </div>
  );
}

function uniqueNames(stock: StockViewVariant): string {
  const names = new Set<string>();
  for (const position of stock.positions) {
    if (position.sourceConnectionName) names.add(position.sourceConnectionName);
  }
  return names.size > 0 ? [...names].join(', ') : '—';
}

function howWeKnow(stock: StockViewVariant): ReactNode {
  if (stock.provenance === 'unknown') return <span className="av-unknown">Unknown</span>;
  if (stock.provenance === 'authority') return 'Reported by an external system';
  return 'Worked out by OpenLinker';
}

export function StockVariantDrawer({
  rowKey,
  variantId,
  state,
  stock,
  channelsStatus,
}: StockVariantDrawerProps): ReactElement {
  const multi = isMultiLocation(stock);
  const live = stock.positions.filter((position) => !position.isStale);
  const locationNames = [...new Set(live.map((p) => p.locationName).filter((n): n is string => !!n))];
  const counted = publishedHolds(stock.holds);
  const recordedOnly = recordedOnlyHolds(stock.holds);
  const masterName = uniqueNames(stock);

  return (
    <div className="variant-drawer" data-testid={`stock-drawer-${rowKey}`}>
      <div className="variant-drawer__meta" data-testid={`stock-provenance-${rowKey}`}>
        <MetaCell label="Master connection">{multi ? `${masterName}` : masterName}</MetaCell>
        <MetaCell label="Location">
          {multi
            ? `${stock.livePositionCount} locations - see below`
            : locationNames.length > 0
              ? locationNames.join(', ')
              : 'No location reported'}
        </MetaCell>
        <MetaCell label="Last synced">
          {stock.observedAt ? (
            <>
              <TimeDisplay className="mono-text" iso={stock.observedAt} />{' '}
              {stock.stalenessMs !== null ? (
                <span className="variant-drawer__meta-muted">{formatStaleness(stock.stalenessMs)}</span>
              ) : null}
            </>
          ) : (
            '—'
          )}
        </MetaCell>
        <MetaCell label="How we know">{howWeKnow(stock)}</MetaCell>
      </div>

      {state === 'unknown' ? (
        <p className="av-formula">
          <b>{stock.masterAvailable}</b> in master stock <span className="av-formula__op">−</span> units held for
          orders <span className="av-formula__op">=</span> <span className="av-unknown">unknown</span>. OpenLinker
          won&apos;t send a number to channels until it can read its holds again.
        </p>
      ) : state === 'staled' ? (
        <p className="av-formula">
          The master stopped reporting <b>{rowKey}</b>
          {stock.positions[0] ? (
            <>
              {' '}
              on <TimeDisplay iso={stock.positions[0].updatedAt} />
            </>
          ) : null}
          . This position is no longer counted, so available to promise is <b>0</b> and its listings are paused. If
          the variant was deleted on purpose, nothing else is needed.
        </p>
      ) : (
        <p className="av-formula">
          <b>{stock.masterAvailable}</b> in master stock <span className="av-formula__op">−</span>{' '}
          <b>{stock.heldCounted ?? 0}</b> held for orders <span className="av-formula__op">=</span>{' '}
          <b>{stock.availableToPromise ?? 0}</b> available to promise
        </p>
      )}

      {state === 'ok' && stock.masterReserved > 0 ? (
        <p className="av-footline">
          The master&apos;s own {stock.masterReserved} reserved are already taken out of {stock.masterAvailable}.
        </p>
      ) : null}

      {state !== 'unknown' && counted.length > 0 ? (
        <div className="av-holds" data-testid={`stock-holds-${rowKey}`}>
          {counted.map((hold) => (
            <Link
              key={`${hold.orderRecordId}`}
              to={`/orders/${encodeURIComponent(hold.orderRecordId)}`}
              className="chip chip--info"
              data-testid={`stock-hold-${holdLabel(hold)}`}
            >
              {holdLabel(hold)} × {hold.quantity}
            </Link>
          ))}
        </div>
      ) : null}

      {state === 'ok' && stock.holds === null ? (
        <p className="av-footline">The orders holding stock couldn&apos;t be listed.</p>
      ) : null}

      {state !== 'unknown' && recordedOnly.length > 0 ? (
        <p className="av-footline">
          Recorded but not counted:{' '}
          {recordedOnly.map((hold) => `${holdLabel(hold)} (${hold.quantity})`).join(', ')}.
        </p>
      ) : null}

      {stock.positions.length > 1 ? (
        <div className="av-ch-scroll av-positions">
          <table className="av-ch-table" data-testid={`stock-positions-${rowKey}`}>
            <thead>
              <tr>
                <th>Location</th>
                <th>Master connection</th>
                <th className="av-ch-num">Stock</th>
                <th className="av-ch-num">Its own reserved</th>
                <th>Last synced</th>
              </tr>
            </thead>
            <tbody>
              {stock.positions.map((position, index) => (
                <tr key={`${position.locationId ?? 'none'}:${position.sourceConnectionId ?? 'none'}:${index}`}>
                  <td>
                    {position.locationName ?? '—'}
                    {position.isStale ? (
                      <>
                        {' '}
                        <StatusBadge tone="warning" compact withDot>
                          Stale
                        </StatusBadge>
                        <span className="av-sub">Not counted</span>
                      </>
                    ) : null}
                  </td>
                  <td>{position.sourceConnectionName ?? '—'}</td>
                  <td className="av-ch-num">{position.availableQuantity}</td>
                  <td className="av-ch-num">{position.reservedQuantity}</td>
                  <td>
                    <TimeDisplay className="mono-text" iso={position.updatedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {channelsStatus === 'unavailable' ? (
        <p className="av-footline">Channels couldn&apos;t be listed right now, so this doesn&apos;t say where the variant is published.</p>
      ) : stock.channels.length > 0 ? (
        <div className="av-ch-scroll">
          <table className="av-ch-table" data-testid={`stock-channels-${rowKey}`}>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Rule on this connection</th>
                <th className="av-ch-num">Will publish</th>
                <th className="av-ch-num">Channel shows</th>
              </tr>
            </thead>
            <tbody>
              {stock.channels.map((channel) => {
                const willPublishKnown = channel.willPublish.quantity !== null && state !== 'unknown';
                return (
                  <tr key={channel.connectionId} data-testid={`stock-channel-${rowKey}-${channel.platformType}`}>
                    <td>
                      <span className="av-ch-name">
                        <span className="av-ch-dot" data-channel={channel.platformType}></span>
                        {channel.connectionName}
                      </span>
                    </td>
                    <td>
                      {describeChannelRule(channel.rule)}
                      {!willPublishKnown ? (
                        <span className="av-sub">Not sent until available to promise is known</span>
                      ) : null}
                    </td>
                    <td className="av-ch-num">
                      {willPublishKnown ? channel.willPublish.quantity : <span className="av-unknown">On hold</span>}
                    </td>
                    <td className="av-ch-num">
                      {channel.channelShows.quantity !== null ? (
                        <>
                          {channel.channelShows.quantity}
                          {channel.channelShows.observedAt ? (
                            <span className="av-sub">
                              seen <TimeDisplay iso={channel.channelShows.observedAt} format="time" />
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="av-dash">Not seen yet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {channelsStatus === 'partial' ? (
        <p className="av-footline">Some channels couldn&apos;t be read and are missing from this list.</p>
      ) : null}

      <div className="av-drawer-links">
        <Link
          className="variant-drawer__link"
          to={`/inventory/movements?productVariantId=${encodeURIComponent(variantId)}`}
          data-testid={`stock-movements-${rowKey}`}
        >
          Stock movements for {rowKey} <span className="variant-drawer__arrow">→</span>
        </Link>
      </div>
    </div>
  );
}
