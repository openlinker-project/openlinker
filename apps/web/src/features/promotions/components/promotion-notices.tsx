/**
 * PromotionNotices (#3940, #3935)
 *
 * The states of a saved promotion that need a sentence, shown as alerts under
 * the page header: read-only, paused by itself (stock or limit), ended, and
 * "you are editing a live promotion". They are states of the same form, never a
 * separate screen. The resume-with-more-units and extend-with-a-new-date
 * controls live in their alert because that is where the operator reads why.
 *
 * @module apps/web/src/features/promotions/components
 */
import { useState, type ReactElement } from 'react';
import { formatAbsoluteDate as formatDate } from '../../../shared/format/format-date';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import type { Promotion } from '../api/promotions.types';
import { isSelfPaused } from '../lib/promotion-view';

export interface PromotionNoticesProps {
  promotion: Promotion | null;
  canWrite: boolean;
  saving: boolean;
  /** True while the form is incomplete: extending an ended rule needs a saveable form. */
  hasProblems: boolean;
  onResume: (additionalUnits: number) => void;
  onExtend: (to: string) => void;
}

export function PromotionNotices({
  promotion: rule,
  canWrite,
  saving,
  hasProblems,
  onResume,
  onExtend,
}: PromotionNoticesProps): ReactElement {
  const copy = useMessages('promotions');
  const [extendTo, setExtendTo] = useState('');
  const [resumeUnits, setResumeUnits] = useState('50');
  const selfPaused = rule !== null && isSelfPaused(rule);

  return (
    <>
      {!canWrite ? (
        <Alert tone="info" data-testid="promotion-readonly-notice">
          {copy.detail.readOnly}
        </Alert>
      ) : null}

      {selfPaused && rule !== null ? (
        <Alert
          tone="warning"
          title={
            rule.pausedReason === 'unit-cap' ? copy.detail.paused.limitTitle : copy.detail.paused.stockTitle
          }
          data-testid="promotion-selfpause-alert"
          action={
            rule.pausedReason === 'unit-cap' && canWrite ? (
              <span className="pm-inline-form">
                <Input
                  type="number"
                  min={1}
                  aria-label={copy.detail.paused.resumeUnits}
                  value={resumeUnits}
                  onChange={(event) => setResumeUnits(event.target.value)}
                  data-testid="promotion-resume-units"
                />
                <Button
                  disabled={saving || !(Number(resumeUnits) > 0)}
                  onClick={() => onResume(Number(resumeUnits))}
                  data-testid="promotion-resume"
                >
                  {copy.detail.paused.resume}
                </Button>
              </span>
            ) : null
          }
        >
          {rule.pausedReason === 'unit-cap'
            ? interpolate(copy.detail.paused.limitBody, {
                given: String(rule.unitsGiven),
                cap: String(rule.effectiveCap ?? rule.unitsGiven),
              })
            : copy.detail.paused.stockBody}
        </Alert>
      ) : null}

      {rule?.status === 'ended' ? (
        <Alert
          tone="info"
          title={interpolate(copy.detail.ended.title, {
            date: formatDate(rule.effectiveTo ?? rule.updatedAt),
          })}
          data-testid="promotion-ended-alert"
          action={
            canWrite ? (
              <span className="pm-inline-form">
                <Input
                  type="date"
                  aria-label={copy.detail.ended.to}
                  value={extendTo}
                  onChange={(event) => setExtendTo(event.target.value)}
                  data-testid="promotion-extend-to"
                />
                <Button
                  disabled={saving || extendTo === '' || hasProblems}
                  onClick={() => onExtend(extendTo)}
                  data-testid="promotion-extend"
                >
                  {copy.detail.ended.extend}
                </Button>
              </span>
            ) : null
          }
        >
          {copy.detail.ended.body}
        </Alert>
      ) : null}

    </>
  );
}
