/**
 * GiftRuleNotices (#3940, #3935)
 *
 * The states of a saved promotion that need a sentence, shown as alerts under
 * the page header: read-only, paused by itself (stock or limit), ended, and
 * "you are editing a live promotion". They are states of the same form, never a
 * separate screen. The resume-with-more-units and extend-with-a-new-date
 * controls live in their alert because that is where the operator reads why.
 *
 * @module apps/web/src/features/gifts/components
 */
import { useState, type ReactElement } from 'react';
import { formatAbsoluteDate as formatDate } from '../../../shared/format/format-date';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import type { GiftRule } from '../api/gifts.types';
import { isSelfPaused } from '../lib/gift-rule-view';

export interface GiftRuleNoticesProps {
  rule: GiftRule | null;
  canWrite: boolean;
  saving: boolean;
  /** True while the form is incomplete: extending an ended rule needs a saveable form. */
  hasProblems: boolean;
  onResume: (additionalUnits: number) => void;
  onExtend: (to: string) => void;
}

export function GiftRuleNotices({
  rule,
  canWrite,
  saving,
  hasProblems,
  onResume,
  onExtend,
}: GiftRuleNoticesProps): ReactElement {
  const copy = useMessages('gifts');
  const [extendTo, setExtendTo] = useState('');
  const [resumeUnits, setResumeUnits] = useState('50');
  const selfPaused = rule !== null && isSelfPaused(rule);

  return (
    <>
      {!canWrite ? (
        <Alert tone="info" data-testid="gift-rule-readonly-notice">
          {copy.list.readOnly}
        </Alert>
      ) : null}

      {selfPaused && rule !== null ? (
        <Alert
          tone="warning"
          title={
            rule.pausedReason === 'unit-cap' ? copy.composer.limitTitle : copy.composer.pausedStockTitle
          }
          data-testid="gift-composer-selfpause-alert"
          action={
            rule.pausedReason === 'unit-cap' && canWrite ? (
              <span className="gift-composer__resume">
                <Input
                  type="number"
                  min={1}
                  aria-label={copy.composer.resumeUnits}
                  value={resumeUnits}
                  onChange={(event) => setResumeUnits(event.target.value)}
                  data-testid="gift-composer-resume-units"
                />
                <Button
                  disabled={saving || !(Number(resumeUnits) > 0)}
                  onClick={() => onResume(Number(resumeUnits))}
                  data-testid="gift-composer-resume"
                >
                  {copy.composer.resume}
                </Button>
              </span>
            ) : null
          }
        >
          {rule.pausedReason === 'unit-cap'
            ? interpolate(copy.composer.limitBody, {
                given: String(rule.unitsGiven),
                cap: String(rule.effectiveCap ?? rule.unitsGiven),
              })
            : copy.composer.pausedStockBody}
        </Alert>
      ) : null}

      {rule?.status === 'ended' ? (
        <Alert
          tone="info"
          title={interpolate(copy.composer.endedTitle, {
            date: formatDate(rule.effectiveTo ?? rule.updatedAt),
          })}
          data-testid="gift-composer-ended-alert"
          action={
            canWrite ? (
              <span className="gift-composer__resume">
                <Input
                  type="date"
                  aria-label={copy.composer.extendTo}
                  value={extendTo}
                  onChange={(event) => setExtendTo(event.target.value)}
                  data-testid="gift-composer-extend-to"
                />
                <Button
                  disabled={saving || extendTo === '' || hasProblems}
                  onClick={() => onExtend(extendTo)}
                  data-testid="gift-composer-extend"
                >
                  {copy.composer.extend}
                </Button>
              </span>
            ) : null
          }
        >
          {copy.composer.endedBody}
        </Alert>
      ) : null}

      {rule !== null && rule.status === 'active' ? (
        <Alert tone="info" data-testid="gift-composer-edit-alert">
          {copy.composer.editNote}
        </Alert>
      ) : null}
    </>
  );
}
