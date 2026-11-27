/**
 * Variant stock summary (#4061)
 *
 * Shown above the history when it is narrowed to one variant: the sum the
 * channels are offered (on hand minus reserved) and what each channel showed
 * the last time OpenLinker looked, beside what OpenLinker last sent it (#4062).
 * Read from the stock view, the same numbers the publisher uses. The two are
 * compared only when both are known: a channel never seen, or a send that did
 * not land, is stated as such rather than called a mismatch.
 *
 * @module apps/web/src/features/inventory/components
 */
import type { ReactElement } from 'react';
import { interpolate } from '../../../shared/i18n';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { StockViewChannel, StockViewVariant } from '../api/inventory.types';
import type { StockGuideId, StockHistoryCopy } from '../lib/stock-movement-view-model';

export interface VariantStockSummaryProps {
  variant: StockViewVariant;
  copy: StockHistoryCopy;
  onExplain: (guideId: StockGuideId) => void;
}

type ChannelFlag = 'mismatch' | 'lastFailed' | null;

function channelFlag(channel: StockViewChannel): ChannelFlag {
  const sent = channel.lastSent;
  if (!sent) return null;
  if (sent.outcome === 'failed') return 'lastFailed';
  const shows = channel.channelShows.quantity;
  if (sent.outcome === 'sent' && sent.quantity !== null && shows !== null && sent.quantity !== shows) {
    return 'mismatch';
  }
  return null;
}

export function VariantStockSummary({ variant, copy, onExplain }: VariantStockSummaryProps): ReactElement {
  const s = copy.summary;
  const terms: { label: string; value: number | null; guide: StockGuideId; result?: boolean }[] = [
    { label: s.onHand, value: variant.masterAvailable, guide: 'numbers.onHand' },
    // OpenLinker's own holds that count against what it offers. The master's
    // own reservations are already netted out of `masterAvailable`.
    { label: s.reserved, value: variant.heldCounted, guide: 'numbers.reserved' },
    { label: s.available, value: variant.availableToPromise, guide: 'numbers.available', result: true },
  ];
  return (
    <section className="stock-variant" aria-label={s.title} data-testid="stock-variant-summary">
      <h2 className="stock-variant__title">{s.title}</h2>
      <div className="stock-variant__sum">
        {terms.map((term, index) => (
          <div key={term.guide} className="stock-variant__term-wrap">
            {index > 0 ? (
              <span className="stock-variant__op" aria-hidden="true">
                {index === 1 ? '−' : '='}
              </span>
            ) : null}
            <button
              type="button"
              className={term.result ? 'stock-variant__term stock-variant__term--result' : 'stock-variant__term'}
              onClick={() => onExplain(term.guide)}
            >
              <span className="stock-variant__label">{term.label}</span>
              <span className="stock-variant__value tabular">{term.value ?? '?'}</span>
            </button>
          </div>
        ))}
      </div>
      <div className="stock-variant__channels">
        <h3>{s.channels}</h3>
        {variant.channels.length === 0 ? (
          <p className="stock-variant__quiet">{s.noChannels}</p>
        ) : (
          <ul>
            {variant.channels.map((channel) => {
              const flag = channelFlag(channel);
              const sent = channel.lastSent;
              return (
                <li key={channel.connectionId} data-flag={flag ?? undefined}>
                  <span className="stock-variant__channel">{channel.connectionName}</span>
                  <span className="stock-variant__figures">
                    <span className="stock-variant__shows tabular" data-testid="stock-variant-sent">
                      {sent && sent.quantity !== null ? interpolate(s.sent, { n: sent.quantity }) : s.sentNothing}
                    </span>
                    <span className="stock-variant__shows tabular">
                      {channel.channelShows.quantity === null
                        ? s.showsUnknown
                        : interpolate(s.shows, { n: channel.channelShows.quantity })}
                    </span>
                    {flag === 'mismatch' ? (
                      <span title={s.mismatchHint}>
                        <StatusBadge compact tone="warning">
                          {s.mismatch}
                        </StatusBadge>
                      </span>
                    ) : flag === 'lastFailed' ? (
                      <StatusBadge compact tone="error">
                        {s.lastFailed}
                      </StatusBadge>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
