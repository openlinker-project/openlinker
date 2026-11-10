/**
 * PromotionComposer (#3935, mockup `promotions-detail`)
 *
 * The page of one saved promotion: the editable title with its state, the
 * benefit type, the numbered cards of the form in the main column and what
 * helps while editing in the rail. It owns the one `react-hook-form` instance
 * (through `usePromotionFormState`); each card is a section component that only
 * reads and writes through it.
 *
 * Saving never blocks on a disabled button: pressing it with something missing
 * draws what is missing on the fields and moves to the first of them.
 *
 * @module apps/web/src/features/promotions/components
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../shared/ui/dropdown-menu';
import { PageLayout } from '../../../shared/ui/page-layout';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { SaveButton, useSaveButtonState } from '../../../shared/ui/save-button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { GuideButton } from '../../../shared/ui/guide-drawer';
import { useConnectionsQuery } from '../../connections';
import type { Promotion } from '../api/promotions.types';
import { formToWriteInput, type PromotionFormValues } from '../lib/promotion-form';
import { focusFirstInvalid, usePromotionFormState } from '../lib/promotion-form-state';
import { PROMOTION_STATE_TONE, promotionStateKey } from '../lib/promotion-view';
import { BenefitTypeCard } from './promotion-benefit-type';
import { PromotionChannelChip } from './promotion-channel-chip';
import { PromotionChannelsSection } from './promotion-channels-section';
import { PromotionCombineSection } from './promotion-combine-section';
import { PromotionGiftSection } from './promotion-gift-section';
import { PromotionLimitsSection } from './promotion-limits-section';
import { PromotionNameSection } from './promotion-name-section';
import { PromotionNotices } from './promotion-notices';
import { PromotionPeriodSection } from './promotion-period-section';
import { PromotionRail } from './promotion-rail';
import { PromotionWhenSection } from './promotion-when-section';

/** Vertical-ellipsis glyph on the menu trigger; the accessible name is the aria-label. */
const MENU_GLYPH = '⋯';

export interface PromotionComposerProps {
  initial: PromotionFormValues;
  promotion: Promotion;
  /** Every promotion in check order. */
  all: readonly Promotion[];
  canWrite: boolean;
  saving: boolean;
  /** Increases by one each time a save succeeds (drives the "Saved" state of the button). */
  savedCount: number;
  onSave: (values: PromotionFormValues, isActive: boolean, extend?: { to: string }) => void;
  onResume: (additionalUnits: number) => void;
  onCopy: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  saveError: string | null;
}

export function PromotionComposer({
  initial,
  promotion,
  all,
  canWrite,
  saving,
  savedCount,
  onSave,
  onResume,
  onCopy,
  onDelete,
  deleting = false,
  saveError,
}: PromotionComposerProps): ReactElement {
  const copy = useMessages('promotions');
  const saveState = useSaveButtonState(saving, savedCount);
  const connections = useConnectionsQuery();
  const state = usePromotionFormState({
    initial,
    editedKey: `${promotion.id}|${promotion.updatedAt}`,
    suggest: () => '',
  });
  const { form, values, problems, invalid } = state;
  const root = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const [titleDraft, setTitleDraft] = useState(values.name);

  useEffect(() => {
    if (editingTitle) {
      titleInput.current?.focus();
      titleInput.current?.select();
    }
  }, [editingTitle]);

  const stateKey = promotionStateKey(promotion);
  const ended = promotion.status === 'ended';
  const isDraft = promotion.status === 'inactive';
  const others = all.filter((p) => p.id !== promotion.id);
  const index = all.findIndex((p) => p.id === promotion.id);
  const disabled = !canWrite || saving;
  const sectionProps = { form, values, readOnly: !canWrite, invalid };

  const covered =
    values.channelIds.length === 0
      ? (connections.data ?? []).filter((c) => c.enabledCapabilities.includes('OrderSource'))
      : (connections.data ?? []).filter((c) => values.channelIds.includes(c.id));

  const submit = (isActive: boolean): void => {
    if (problems.length > 0) {
      state.attempt();
      focusFirstInvalid(root.current);
      return;
    }
    onSave(values, isActive);
  };

  const commitTitle = (save: boolean): void => {
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (save && next !== '') form.setValue('name', next, { shouldDirty: true });
    else setTitleDraft(values.name);
  };
  const onTitleKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTitle(true);
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      commitTitle(false);
    }
  };

  const actions = (
    <ReadOnlyLock active={!canWrite} message={copy.detail.readOnly}>
      <span className="pm-actions">
        <GuideButton label={copy.page.guideButton} />
        {isDraft ? (
          <Button
            tone="secondary"
            className="button--sm"
            disabled={disabled}
            onClick={() => {
              submit(false);
            }}
            data-testid="promotion-save-draft"
          >
            {copy.detail.saveDraft}
          </Button>
        ) : !ended ? (
          <Button
            tone="secondary"
            className="button--sm"
            disabled={disabled}
            onClick={() => {
              submit(false);
            }}
            data-testid="promotion-pause"
          >
            {copy.detail.pause}
          </Button>
        ) : null}
        <SaveButton
          state={saveState}
          labels={{
            idle: isDraft ? copy.detail.turnOn : copy.detail.save,
            saving: isDraft ? copy.detail.turningOn : copy.detail.saving,
            saved: isDraft ? copy.detail.turnedOn : copy.detail.saved,
          }}
          disabled={!canWrite || ended}
          onClick={() => {
            submit(true);
          }}
          data-testid="promotion-primary"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              tone="secondary"
              className="button--sm"
              aria-label={copy.detail.actionsMenu}
              data-testid="promotion-menu"
            >
              {MENU_GLYPH}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onCopy} data-testid="promotion-copy">
              {copy.detail.copy}
            </DropdownMenuItem>
            {onDelete ? (
              <DropdownMenuItem
                disabled={deleting}
                onSelect={() => {
                  setConfirmingDelete(true);
                }}
                data-testid="promotion-delete"
              >
                {copy.detail.delete}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </ReadOnlyLock>
  );

  return (
    <PageLayout
      eyebrow={copy.detail.eyebrow}
      backTo={{ to: '/promotions', label: copy.page.back, 'data-testid': 'promotion-back' }}
      title={
        <span className={['pm-title', editingTitle ? 'is-editing' : ''].filter(Boolean).join(' ')}>
          <span className="pm-title__box">
            <span
              className="pm-title__view"
              onClick={(event) => {
                if (canWrite && !(event.target as HTMLElement).closest('button')) {
                  setTitleDraft(values.name);
                  setEditingTitle(true);
                }
              }}
            >
              <span data-testid="promotion-title">{values.name}</span>
              {canWrite ? (
                <button
                  type="button"
                  className="pm-title__pencil"
                  aria-label={copy.detail.renameAria}
                  title={copy.detail.renameTitle}
                  onClick={() => {
                    setTitleDraft(values.name);
                    setEditingTitle(true);
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 20l4-1L19 8l-3-3L5 16l-1 4z" />
                    <path d="M14 7l3 3" />
                  </svg>
                </button>
              ) : null}
            </span>
            <input
              ref={titleInput}
              className="pm-title__input"
              type="text"
              value={titleDraft}
              maxLength={80}
              aria-label={copy.detail.nameAria}
              tabIndex={editingTitle ? 0 : -1}
              onChange={(event) => {
                setTitleDraft(event.target.value);
              }}
              onKeyDown={onTitleKey}
              onBlur={() => {
                if (editingTitle) commitTitle(true);
              }}
            />
          </span>
          <StatusBadge tone={PROMOTION_STATE_TONE[stateKey]} withDot>
            {copy.status[stateKey]}
          </StatusBadge>
        </span>
      }
      description={
        <>
          {isDraft ? copy.detail.draftNote : copy.detail.editNote}
          <span className="pm-meta pm-meta--head">
            <span className="pm-hint">{copy.detail.channelsLabel}</span>
            <span className="pm-chans">
              {values.channelIds.length === 0 ? (
                <span className="chip">{copy.row.allChannels}</span>
              ) : (
                covered.map((channel) => <PromotionChannelChip key={channel.id} connection={channel} link />)
              )}
            </span>
            {index >= 0 ? (
              <span className="pm-hint pm-meta__pos">
                {interpolate(copy.detail.position, { n: String(index + 1), total: String(all.length) })}
              </span>
            ) : null}
          </span>
        </>
      }
      actions={actions}
    >
      <div ref={root} className="pm-page" data-testid="promotion-composer">
        <PromotionNotices
          promotion={promotion}
          canWrite={canWrite}
          saving={saving}
          hasProblems={problems.length > 0}
          onResume={onResume}
          onExtend={(to) => {
            onSave({ ...values, to }, true, { to });
          }}
        />
        {saveError !== null ? (
          <Alert tone="error" data-testid="promotion-save-error">
            {saveError}
          </Alert>
        ) : null}
        <BenefitTypeCard />
        <div className="pm-grid">
          <div className="pm-col">
            <PromotionNameSection {...sectionProps} step="00" riseIndex={2} onTyped={state.markNameTyped} />
            <PromotionWhenSection {...sectionProps} step="01" riseIndex={3} />
            <PromotionGiftSection {...sectionProps} step="02" riseIndex={4} />
            <PromotionChannelsSection {...sectionProps} step="03" riseIndex={5} />
            <PromotionCombineSection {...sectionProps} step="04" riseIndex={6} others={others} />
            <PromotionPeriodSection {...sectionProps} step="05" riseIndex={7} />
            <PromotionLimitsSection
              {...sectionProps}
              step="06"
              riseIndex={8}
              settingsHref="/settings/sales-documents"
              aside={
                promotion.effectiveCap !== null
                  ? interpolate(copy.table.pcs, {
                      given: String(promotion.unitsGiven),
                      cap: String(promotion.effectiveCap),
                    })
                  : undefined
              }
            />
          </div>
          <PromotionRail
            values={values}
            promotion={promotion}
            all={all}
            draft={problems.length === 0 ? formToWriteInput(values, true) : null}
            ready={problems.length === 0}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete && onDelete !== undefined}
        onOpenChange={setConfirmingDelete}
        tone="danger"
        title={copy.detail.deleteTitle}
        description={copy.detail.deleteBody}
        confirmLabel={copy.detail.deleteConfirm}
        cancelLabel={copy.detail.deleteKeep}
        isConfirming={deleting}
        onConfirm={() => {
          onDelete?.();
        }}
      />
    </PageLayout>
  );
}
