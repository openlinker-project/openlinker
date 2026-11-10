/**
 * PromotionNew (#3935, mockup `promotions-new`)
 *
 * Creating a promotion in two steps on one page: pick a benefit type and a
 * template, then fill the form with the rail beside it (the rule in one sentence
 * and a dry run) and a sticky bar that says what is still missing. Nothing runs
 * until the operator turns it on; "Save as draft" keeps it off.
 *
 * The step change is a view transition where the browser has them and an
 * instant swap where it does not or the operator asks for less motion.
 *
 * @module apps/web/src/features/promotions/components
 */
import { useRef, useState, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { PageLayout } from '../../../shared/ui/page-layout';
import { SaveButton } from '../../../shared/ui/save-button';
import { StickyActionBar } from '../../../shared/ui/sticky-action-bar';
import { useGuide } from '../../../shared/ui/guide-drawer';
import type { Promotion } from '../api/promotions.types';
import {
  emptyPromotionForm,
  formToWriteInput,
  suggestPromotionName,
  type PromotionFormProblem,
  type PromotionFormValues,
} from '../lib/promotion-form';
import { focusFirstInvalid, usePromotionFormState } from '../lib/promotion-form-state';
import { PromotionChannelsSection } from './promotion-channels-section';
import { PromotionCombineSection } from './promotion-combine-section';
import { PromotionGiftSection } from './promotion-gift-section';
import { PromotionLimitsSection } from './promotion-limits-section';
import { PromotionNameSection } from './promotion-name-section';
import { PromotionPeriodSection } from './promotion-period-section';
import { PromotionRail } from './promotion-rail';
import { PromotionTemplateCards, type PromotionTemplate } from './promotion-template-cards';
import { PromotionWhenSection } from './promotion-when-section';

function withTransition(change: () => void): void {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const start = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
  if (reduce || typeof start !== 'function') {
    change();
    return;
  }
  start.call(document, () => {
    flushSync(change);
  });
}

const MISSING_KEY: Partial<Record<PromotionFormProblem, 'name' | 'gift' | 'amount' | 'product' | 'quantity' | 'period' | 'cap' | 'perN' | 'docPrice' | 'combine'>> = {
  name: 'name',
  gift: 'gift',
  basket: 'amount',
  when: 'product',
  quantity: 'quantity',
  period: 'period',
  'unit-cap': 'cap',
  'per-n': 'perN',
  'doc-price': 'docPrice',
  combine: 'combine',
};

export interface PromotionNewProps {
  /** Starts at the form with these values (a copy of a saved promotion). */
  initial?: PromotionFormValues;
  all: readonly Promotion[];
  canWrite: boolean;
  saving: boolean;
  savedCount: number;
  saveError: string | null;
  onSave: (values: PromotionFormValues, isActive: boolean) => void;
}

export function PromotionNew({
  initial,
  all,
  canWrite,
  saving,
  savedCount,
  saveError,
  onSave,
}: PromotionNewProps): ReactElement {
  const copy = useMessages('promotions');
  const openGuide = useGuide();
  const [template, setTemplate] = useState<PromotionTemplate | null>(initial !== undefined ? 'empty' : null);
  const root = useRef<HTMLDivElement>(null);
  const [shaking, setShaking] = useState(false);
  const [intent, setIntent] = useState<'draft' | 'on'>('on');

  const state = usePromotionFormState({
    initial: initial ?? emptyPromotionForm('basket'),
    editedKey: initial?.name ?? 'new',
    suggest: (values) => suggestPromotionName(values, copy.new.nameSuggest),
  });
  const { form, values, problems, invalid } = state;
  const sectionProps = { form, values, readOnly: !canWrite, invalid };

  const choose = (next: PromotionTemplate): void => {
    withTransition(() => {
      if (next !== 'empty') form.setValue('kind', next);
      setTemplate(next);
    });
    window.scrollTo({ top: 0 });
  };
  const back = (): void => {
    withTransition(() => {
      setTemplate(null);
    });
  };

  const missing = problems
    .map((problem) => MISSING_KEY[problem])
    .filter((key): key is NonNullable<typeof key> => key !== undefined)
    .map((key) => copy.new.missingItems[key])
    .join(', ');

  const submit = (isActive: boolean): void => {
    setIntent(isActive ? 'on' : 'draft');
    if (problems.length > 0) {
      state.attempt();
      setShaking(true);
      window.setTimeout(() => {
        setShaking(false);
      }, 450);
      focusFirstInvalid(root.current);
      return;
    }
    onSave(values, isActive);
  };

  const header = {
    eyebrow: copy.detail.eyebrow,
    backTo: { to: '/promotions', label: copy.page.back, 'data-testid': 'promotion-back' },
    title: <span data-testid="promotion-new-title">{copy.new.title}</span>,
    description: copy.new.description,
    actions: (
      <button
        type="button"
        className="button button--secondary button--sm pm-helpbtn"
        onClick={() => {
          openGuide?.(null);
        }}
      >
        <span className="pm-qmark" aria-hidden="true">
          ?
        </span>
        {copy.page.guideButton}
        <span className="button__shortcut" aria-hidden="true">
          ?
        </span>
      </button>
    ),
  };

  if (template === null) {
    return (
      <PageLayout {...header}>
        <PromotionTemplateCards onChoose={choose} />
      </PageLayout>
    );
  }

  return (
    <PageLayout {...header}>
      <div className="pm-stage" ref={root} data-testid="promotion-new-form">
        <button type="button" className="pm-linkbtn" onClick={back} data-testid="promotion-change-template">
          <span aria-hidden="true">‹</span>
          {copy.new.changeTemplate}
        </button>
        {saveError !== null ? (
          <Alert tone="error" data-testid="promotion-save-error">
            {saveError}
          </Alert>
        ) : null}
        <div className="pm-grid">
          <div className="pm-col">
            <PromotionNameSection
              {...sectionProps}
              step="01"
              riseIndex={0}
              onTyped={state.markNameTyped}
              suggestion={state.suggestion}
            />
            <PromotionWhenSection {...sectionProps} step="02" riseIndex={1} offerUnit />
            <PromotionGiftSection {...sectionProps} step="03" riseIndex={2} />
            <PromotionChannelsSection {...sectionProps} step="04" riseIndex={3} />
            <PromotionCombineSection
              {...sectionProps}
              step="05"
              riseIndex={4}
              others={all}
              withPeriod
              withSkip={false}
            >
              <PromotionPeriodSection {...sectionProps} bare />
            </PromotionCombineSection>
            <PromotionLimitsSection
              {...sectionProps}
              step="06"
              riseIndex={5}
              isNew
              settingsHref="/settings/sales-documents"
            />
          </div>
          <PromotionRail
            values={values}
            promotion={null}
            all={all}
            draft={problems.length === 0 ? formToWriteInput(values, true) : null}
            ready={problems.length === 0}
            riseIndex={1}
          />
        </div>
        <StickyActionBar
          missingLabel={copy.new.missing}
          missing={missing}
          readyText={copy.new.ready}
          shaking={shaking}
        >
          <Button
            tone="secondary"
            className="button--sm"
            disabled={!canWrite || saving}
            onClick={() => {
              submit(false);
            }}
            data-testid="promotion-save-draft"
          >
            {copy.detail.saveDraft}
          </Button>
          <SaveButton
            label={copy.detail.turnOn}
            busyLabel={copy.detail.turningOn}
            doneLabel={copy.detail.turnedOn}
            pending={saving && intent === 'on'}
            savedCount={savedCount}
            disabled={!canWrite || (saving && intent === 'draft')}
            onClick={() => {
              submit(true);
            }}
            data-testid="promotion-primary"
          />
        </StickyActionBar>
      </div>
    </PageLayout>
  );
}

