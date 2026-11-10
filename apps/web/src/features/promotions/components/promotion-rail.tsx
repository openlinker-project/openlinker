/**
 * PromotionRail (#3935, mockups: the right column of `promotions-detail` and
 * `promotions-new`)
 *
 * What helps while editing, beside the form: the promotion in one sentence with
 * its channels, where it sits in the checking order and what it gave in the last
 * 30 days (saved promotions only), and one card with the dry run on an order and
 * the promotion's history. A promotion that is not saved has no position, no
 * results and no history, so those parts are not drawn for it rather than drawn
 * empty.
 *
 * @module apps/web/src/features/promotions/components
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import { ComposerSection } from '../../../shared/ui/composer-section';
import { HelpHint } from '../../../shared/ui/help-hint';
import { ReadbackSentence } from '../../../shared/ui/readback-sentence';
import { useConnectionsQuery } from '../../connections';
import type { Promotion, PromotionWriteInput } from '../api/promotions.types';
import { usePromotionReportQuery } from '../hooks/use-promotion-report';
import type { PromotionFormValues } from '../lib/promotion-form';
import { summarisePromotionResults } from '../lib/promotion-stats';
import { PromotionChannelChip } from './promotion-channel-chip';
import { PromotionHistoryPanel } from './promotion-history-panel';
import { PromotionResultsBody } from './promotion-results';
import { PromotionSentence } from './promotion-sentence';
import { PromotionTestPanel } from './promotion-test-panel';

export interface PromotionRailProps {
  values: PromotionFormValues;
  /** The saved promotion; `null` for a new one. */
  promotion: Promotion | null;
  /** Every promotion, in check order (the list the position is read from). */
  all: readonly Promotion[];
  draft: PromotionWriteInput | null;
  /** Whether the form is complete enough to test. */
  ready: boolean;
  /** Rise index of the first card. */
  riseIndex?: number;
}

type RailTab = 'test' | 'history';

function RailTabs({
  value,
  onChange,
  labels,
  ariaLabel,
}: {
  value: RailTab;
  onChange: (next: RailTab) => void;
  labels: Record<RailTab, string>;
  ariaLabel: string;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el) setIndicator({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value]);
  return (
    <div className="pm-tabs" role="tablist" aria-label={ariaLabel} ref={ref}>
      {(['test', 'history'] as const).map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          className="status-tab"
          aria-selected={value === tab}
          onClick={() => {
            onChange(tab);
          }}
          data-testid={`promotion-tab-${tab}`}
        >
          {labels[tab]}
        </button>
      ))}
      <span
        className="status-tabs__indicator"
        aria-hidden="true"
        style={{ width: indicator.w, transform: `translateX(${indicator.x}px)` }}
      />
    </div>
  );
}

export function PromotionRail({
  values,
  promotion,
  all,
  draft,
  ready,
  riseIndex = 1,
}: PromotionRailProps): ReactElement {
  const messages = useMessages('promotions');
  const copy = messages.rail;
  const connections = useConnectionsQuery();
  const [tab, setTab] = useState<RailTab>('test');
  const saved = promotion !== null;
  const report = usePromotionReportQuery(saved);

  const channels = useMemo(() => connections.data ?? [], [connections.data]);
  const covered = values.channelIds.length === 0 ? [] : channels.filter((c) => values.channelIds.includes(c.id));
  const combineNames = values.combineIds.map((id) => all.find((p) => p.id === id)?.name ?? id);
  const results = useMemo(
    () => (promotion === null || report.data === undefined ? null : summarisePromotionResults(report.data.groups, promotion.id)),
    [promotion, report.data],
  );

  const index = promotion === null ? -1 : all.findIndex((p) => p.id === promotion.id);
  const total = all.length;
  const position = index + 1;
  const positionText =
    position === 1 ? copy.order.first : position === total ? copy.order.last : interpolate(copy.order.nth, { n: String(position) });

  return (
    <aside className="pm-col pm-rail" aria-label={messages.page.title}>
      <ReadbackSentence
        eyebrow={messages.rb.eyebrow}
        name={values.name.trim() === '' ? <span className="pm-ph">{messages.rb.name_ph}</span> : values.name}
        riseIndex={riseIndex}
        data-testid="promotion-readback"
        footer={
          saved && covered.length > 0 ? (
            <div className="pm-chanline">
              <span className="pm-hint">{messages.rb.channelsLabel}</span>
              <span className="pm-chans">
                {covered.map((channel) => (
                  <PromotionChannelChip key={channel.id} connection={channel} link />
                ))}
              </span>
            </div>
          ) : undefined
        }
      >
        <PromotionSentence values={values} channels={channels} combineNames={combineNames} />
      </ReadbackSentence>

      {saved && index >= 0 ? (
        <ComposerSection
          title={
            <>
              {copy.order.title}{' '}
              <HelpHint guide="g-order" label={copy.order.help} />
            </>
          }
          aside={interpolate(copy.order.of, { n: String(position), total: String(total) })}
          riseIndex={riseIndex + 1}
          data-testid="promotion-order-card"
        >
          <div className="pm-pos">
            <span className="pm-pos__bars" aria-hidden="true">
              {all.slice(0, 6).map((p, i) => (
                <i key={p.id} className={i === index ? 'is-on' : p.status === 'ended' ? 'is-off' : ''} />
              ))}
            </span>
            <span className="pm-pos__row">
              <span>{positionText}</span>
              <Link className="link pm-link" to="/promotions">
                {copy.order.change}
              </Link>
            </span>
          </div>
        </ComposerSection>
      ) : null}

      {promotion !== null ? (
        <ComposerSection
          title={messages.results.title}
          aside={messages.results.range}
          asideCaps
          riseIndex={riseIndex + 2}
          data-testid="promotion-results-card"
        >
          <PromotionResultsBody promotion={promotion} results={results} failed={report.isError} />
        </ComposerSection>
      ) : null}

      <ComposerSection
        title={saved ? undefined : messages.test.title}
        aside={saved ? undefined : messages.test.aside}
        asideCaps={!saved}
        riseIndex={riseIndex + 3}
        data-testid="promotion-tools"
      >
        {saved ? (
          <>
            <RailTabs
              value={tab}
              onChange={setTab}
              labels={{ test: copy.testTab, history: copy.historyTab }}
              ariaLabel={copy.tabsAria}
            />
            <div className="pm-pane-stack">
              <div className={['pm-pane', tab === 'test' ? 'is-on' : ''].filter(Boolean).join(' ')} role="tabpanel">
                <PromotionTestPanel promotionId={promotion.id} draft={draft} ready={ready} />
              </div>
              <div className={['pm-pane', tab === 'history' ? 'is-on' : ''].filter(Boolean).join(' ')} role="tabpanel">
                <PromotionHistoryPanel promotionId={promotion.id} enabled={tab === 'history'} />
              </div>
            </div>
          </>
        ) : (
          <PromotionTestPanel promotionId={null} draft={draft} ready={ready} />
        )}
      </ComposerSection>
    </aside>
  );
}
