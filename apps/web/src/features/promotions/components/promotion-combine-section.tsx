/**
 * PromotionCombineSection (#3935, mockups "Łączenie i duplikaty")
 *
 * Whether the promotion stacks with the others, and what to do when the gift is
 * already in the order. Stacking needs both promotions to agree, so "only with
 * selected" opens a searchable list of the other promotions to tick; "select
 * all active" is the shortcut most operators want. The "already in the order"
 * choice sits here because it is the same question, seen from the order's side:
 * will the customer end up with two.
 *
 * @module apps/web/src/features/promotions/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { ComposerSection } from '../../../shared/ui/composer-section';
import { HelpHint } from '../../../shared/ui/help-hint';
import { Input } from '../../../shared/ui/input';
import { SegmentedControl, type SegmentedControlOption } from '../../../shared/ui/segmented-control';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useVariantSummaries } from '../../gifts';
import type { Promotion, PromotionCombinationMode } from '../api/promotions.types';
import { PROMOTION_STATE_TONE, promotionStateKey } from '../lib/promotion-view';
import { PromotionField } from './promotion-field';
import type { PromotionSectionProps } from './promotion-section.types';
import { PromotionThumb } from './promotion-thumb';

export interface PromotionCombineSectionProps extends PromotionSectionProps {
  /** The other promotions to choose from (the one being edited is not among them). */
  others: readonly Promotion[];
  /** Merge the "period" fields into this card (new promotion page): the title changes. */
  withPeriod?: boolean;
  /** Skip the "skip if present" row (the card then holds only stacking). */
  withSkip?: boolean;
  children?: ReactElement | null;
}

export function PromotionCombineSection({
  form,
  values,
  readOnly,
  invalid,
  riseIndex,
  step,
  others,
  withPeriod = false,
  withSkip = true,
  children,
}: PromotionCombineSectionProps): ReactElement {
  const messages = useMessages('promotions');
  const copy = messages.s.combine;
  const [query, setQuery] = useState('');
  const summaries = useVariantSummaries(others.map((p) => p.benefit.variantId));

  const modes: SegmentedControlOption<PromotionCombinationMode>[] = [
    { value: 'all', label: copy.all, 'data-testid': 'promotion-combine-all' },
    { value: 'selected', label: copy.selected, 'data-testid': 'promotion-combine-selected' },
    { value: 'none', label: copy.none, 'data-testid': 'promotion-combine-none' },
  ];
  const aside =
    values.combineMode === 'all'
      ? copy.asideAll
      : values.combineMode === 'none'
        ? copy.asideNone
        : interpolate(copy.asideSelected, { n: String(values.combineIds.length) });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return others.filter((promotion) => {
      if (q === '') return true;
      const gift = summaries.get(promotion.benefit.variantId)?.name ?? '';
      return `${promotion.name} ${gift}`.toLowerCase().includes(q);
    });
  }, [others, query, summaries]);

  const setIds = (ids: string[]): void => {
    form.setValue('combineIds', ids, { shouldDirty: true });
  };
  const toggle = (id: string): void => {
    setIds(
      values.combineIds.includes(id)
        ? values.combineIds.filter((existing) => existing !== id)
        : [...values.combineIds, id],
    );
  };

  return (
    <ComposerSection
      step={step}
      title={withPeriod ? messages.s.combineSimple.title : copy.title}
      aside={withPeriod ? messages.s.combineSimple.aside : aside}
      riseIndex={riseIndex}
      id="promotion-combine"
      data-testid="promotion-combine-section"
    >
      <fieldset className="pm-fieldset" disabled={readOnly}>
        <div className="pm-sub">
          <PromotionField
            label={copy.question}
            hint={<HelpHint guide="g-nostack" label={copy.helpLabel} />}
            description={copy.help}
            invalid={invalid?.has('combine') === true}
            error={copy.error}
            id="promotion-combine-field"
          >
            <SegmentedControl
              aria-label={copy.groupAria}
              options={modes}
              value={values.combineMode}
              onChange={(mode) => {
                form.setValue('combineMode', mode, { shouldDirty: true });
              }}
            />
            <div className={['pm-disc__body', 'pm-cm-list', values.combineMode === 'selected' ? 'is-open' : ''].filter(Boolean).join(' ')}>
              <div>
                <div className="pm-disc__inner">
                  {others.length === 0 ? (
                    <p className="form-field__description" data-testid="promotion-combine-empty">
                      {copy.noOthers}
                    </p>
                  ) : (
                    <>
                      <div className="pm-cm-tools">
                        <Input
                          className="pm-cm-q"
                          type="search"
                          aria-label={copy.search}
                          placeholder={copy.search}
                          value={query}
                          tabIndex={values.combineMode === 'selected' ? 0 : -1}
                          onChange={(event) => {
                            setQuery(event.target.value);
                          }}
                        />
                        <button
                          type="button"
                          className="pm-linkbtn"
                          tabIndex={values.combineMode === 'selected' ? 0 : -1}
                          onClick={() => {
                            setIds(others.filter((p) => p.status === 'active').map((p) => p.id));
                          }}
                          data-testid="promotion-combine-select-active"
                        >
                          {copy.selectActive}
                        </button>
                      </div>
                      <div className="pm-cmlist">
                        {shown.map((promotion) => {
                          const state = promotionStateKey(promotion);
                          const summary = summaries.get(promotion.benefit.variantId);
                          return (
                            <label
                              key={promotion.id}
                              className="pm-cmrow"
                              data-testid={`promotion-combine-${promotion.id}`}
                            >
                              <input
                                type="checkbox"
                                className="pm-cm-chk"
                                checked={values.combineIds.includes(promotion.id)}
                                tabIndex={values.combineMode === 'selected' ? 0 : -1}
                                onChange={() => {
                                  toggle(promotion.id);
                                }}
                              />
                              <PromotionThumb
                                seed={promotion.benefit.productId}
                                name={summary?.name ?? promotion.name}
                                imageSrc={summary?.imageSrc}
                                className="pm-cmrow__th"
                              />
                              <span className="pm-cmrow__n">
                                <span className="pm-cmrow__t">{promotion.name}</span>
                                <span className="text-muted orders-cell-sub">{summary?.name ?? ''}</span>
                              </span>
                              <span className="mono tabular pm-cmrow__o">#{promotion.position}</span>
                              <StatusBadge tone={PROMOTION_STATE_TONE[state]} withDot compact>
                                {messages.status[state]}
                              </StatusBadge>
                            </label>
                          );
                        })}
                        {shown.length === 0 ? (
                          <p className="form-field__description">{copy.noMatch}</p>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </PromotionField>
          {withSkip ? (
            <div className="pm-optrow">
              <label className="pm-opt">
                <input
                  type="checkbox"
                  checked={values.skipIfPresent}
                  onChange={(event) => {
                    form.setValue('skipIfPresent', event.target.checked, { shouldDirty: true });
                  }}
                  data-testid="promotion-skip-present"
                />
                <span>
                  {copy.skip}
                  <small>{copy.skipHelp}</small>
                </span>
              </label>
              <HelpHint guide="g-skip" label={copy.skipLabel} />
            </div>
          ) : null}
        </div>
        {children}
      </fieldset>
    </ComposerSection>
  );
}
