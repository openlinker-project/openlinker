/**
 * Buyer Data Section (#4289)
 *
 * The connection edit's quiet answer to "which buyer data rules apply to this
 * connection": a read-only summary of the EFFECTIVE rules (own, or the general
 * ones it follows) and a way to the settings page, which is the one place the
 * rules are changed (`/settings/buyer-data?scope=<connectionId>`). Nothing here
 * writes: the form keeps `config.buyerDataRetention` exactly as it loaded it.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import type { CSSProperties, ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui';
import type { EditConnectionFormValues } from '../../connections';
import { useOperationalSettingsQuery } from '../../settings';
import type { BuyerDataOverride } from '../api/buyer-data.types';
import { useShortPeriod } from '../hooks/use-short-period';
import { globalRulesFromSettings, resolveBuyerDataRules } from '../lib/buyer-data-config';
import { AXIS_PCT, daysToPct } from '../lib/retention-scale';

export interface BuyerDataSectionProps {
  connectionId: string;
  form: UseFormReturn<EditConnectionFormValues>;
}

type SegmentKind = 'kept' | 'hidden' | 'erased' | 'never';
interface Segment {
  kind: SegmentKind;
  from: number;
  to: number;
}

/** The lifecycle bar: visible, then hidden, then erased, then the "no end" slot. */
function buildSegments(hideDays: number, eraseDays: number): Segment[] {
  const hideAt = hideDays > 0 ? daysToPct(hideDays) : null;
  const eraseAt = eraseDays > 0 ? daysToPct(eraseDays) : null;
  const out: Segment[] = [{ kind: 'kept', from: 0, to: hideAt ?? eraseAt ?? AXIS_PCT }];
  if (hideAt !== null) out.push({ kind: 'hidden', from: hideAt, to: eraseAt ?? AXIS_PCT });
  if (eraseAt !== null) out.push({ kind: 'erased', from: eraseAt, to: AXIS_PCT });
  out.push({ kind: 'never', from: AXIS_PCT, to: 100 });
  return out.filter((seg) => seg.to > seg.from);
}

export function BuyerDataSection({ connectionId, form }: BuyerDataSectionProps): ReactElement {
  const messages = useMessages('buyer-data');
  const copy = messages.section;
  const rulesCopy = messages.rules;
  const shortPeriod = useShortPeriod();
  const settingsQuery = useOperationalSettingsQuery();

  const override: BuyerDataOverride | null = form.watch('buyerDataRetention') ?? null;
  // The general rules are an admin read: without them only an own override can be summarised.
  const general = settingsQuery.data;
  const globalRules = globalRulesFromSettings(general);
  const own = override !== null;
  const effective = resolveBuyerDataRules(override, globalRules);
  const offHere = own && override.enabled === false && globalRules.enabled;
  const known = own || general !== undefined;
  const ready = !settingsQuery.isPending && known;

  const when = (days: number): string =>
    days <= 0 ? shortPeriod(days) : interpolate(copy.after, { when: shortPeriod(days) });

  // The summary templates end with a full stop, and an abbreviation ("mo.") already has one.
  const inSentence = (days: number): string => when(days).replace(/\.$/, '');

  let tone: StatusBadgeTone = 'neutral';
  let badge = copy.badgeLinked;
  let hint = copy.hintLinked;
  if (offHere) {
    tone = 'warning';
    badge = copy.badgeOffHere;
    hint = copy.hintOffHere;
  } else if (!effective.enabled) {
    badge = copy.badgeOff;
    hint = copy.hintOff;
  } else if (own) {
    tone = 'info';
    badge = copy.badgeOwn;
    hint = copy.hintOwn;
  } else {
    tone = 'success';
    badge = copy.badgeOn;
  }

  const { hideAfterDays: hide, eraseAfterDays: erase } = effective;
  const eraseSentence = interpolate(
    effective.mode === 'whole-order' ? rulesCopy.summaryEraseWhole : rulesCopy.summaryErasePersonal,
    { when: inSentence(erase) }
  );
  const sentence =
    hide <= 0 && erase <= 0
      ? copy.summaryNone
      : [
          hide > 0
            ? interpolate(rulesCopy.summaryHideOn, { when: inSentence(hide) })
            : rulesCopy.summaryHideNever,
          erase > 0 ? eraseSentence : rulesCopy.summaryEraseNever,
        ].join(' ');
  const segments = buildSegments(hide, erase);
  const hasTail = segments.some((seg) => seg.kind === 'never');

  return (
    <section
      className="rate-limit-section buyer-data-summary"
      data-testid="buyer-data-section"
      aria-busy={settingsQuery.isPending}
    >
      <div className="buyer-data-summary__card">
        <header className="buyer-data-summary__head">
          <h3 className="rate-limit-section__title">{copy.heading}</h3>
          {ready ? (
            <span key={badge} className="buyer-data-summary__badge" data-testid="buyer-data-source">
              <StatusBadge tone={tone} withDot compact>
                {badge}
              </StatusBadge>
            </span>
          ) : null}
        </header>
        <p className="rate-limit-section__help">{copy.help}</p>

        {ready ? (
          <div
            className={`buyer-data-summary__body${effective.enabled ? '' : ' buyer-data-summary__body--off'}`}
          >
            <div className="buyer-data-summary__track" aria-hidden="true">
              <div className="buyer-data-summary__bar">
                {segments.map((seg, index) => (
                  <i
                    key={seg.kind}
                    className={`buyer-data-summary__seg buyer-data-summary__seg--${seg.kind}`}
                    style={
                      {
                        left: `${seg.from}%`,
                        width: `${seg.to - seg.from}%`,
                        '--i': index,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
              <div className="buyer-data-summary__caps">
                <span>{copy.trackStart}</span>
                {hasTail ? <span>{copy.trackNever} &rarr;</span> : null}
              </div>
            </div>

            <dl className="buyer-data-summary__legend">
              <div className="buyer-data-summary__legend-item buyer-data-summary__legend-item--hidden">
                <dt>{copy.legendHide}</dt>
                <dd data-testid="buyer-data-fact-hide">{when(hide)}</dd>
              </div>
              <div className="buyer-data-summary__legend-item buyer-data-summary__legend-item--erased">
                <dt>{copy.legendErase}</dt>
                <dd data-testid="buyer-data-fact-erase">{when(erase)}</dd>
              </div>
            </dl>

            <p className="buyer-data-summary__sentence" data-testid="buyer-data-switch">
              {sentence}
            </p>
          </div>
        ) : null}

        <footer className="buyer-data-summary__foot">
          {ready ? (
            <span className="buyer-data-summary__hint" data-testid="buyer-data-hint">
              {hint}
            </span>
          ) : (
            <span />
          )}
          <Link
            className="button button--secondary buyer-data-summary__cta"
            to={`/settings/buyer-data?scope=${encodeURIComponent(connectionId)}`}
            data-testid="buyer-data-cta"
          >
            {copy.cta}
            <svg viewBox="0 0 16 16" className="buyer-data-summary__arrow" aria-hidden="true">
              <path
                d="M3 8h10M9 4l4 4-4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </footer>
      </div>
    </section>
  );
}
