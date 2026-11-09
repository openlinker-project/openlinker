/**
 * GiftRuleComposer (#3940, #3935; mockup `gifts-rule-detail`)
 *
 * The page of one promotion: the header with its actions, the notices, the form
 * in the main column and what helps while editing in the rail. It owns the one
 * `react-hook-form` instance and everything derived from it; each card of the
 * form is a section component that only reads and writes through it.
 *
 * Three kinds of promotion (a gift with a product, from an order amount, for
 * every unit) share the form. Four things are visible up front - when, the gift,
 * channels, period - and the options most promotions never touch are folded
 * under "More options" with a one-line summary.
 *
 * @module apps/web/src/features/gifts/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { useMessages } from '../../../shared/i18n';
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
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { GiftRule } from '../api/gifts.types';
import {
  formToWriteInput,
  suggestRuleName,
  validateGiftRuleForm,
  type GiftRuleFormValues,
} from '../lib/gift-rule-form';
import { RULE_STATE_TONE, ruleStateKey } from '../lib/gift-rule-view';
import { GiftRuleChannelsSection } from './gift-rule-channels-section';
import { GiftRuleGiftSection } from './gift-rule-gift-section';
import { GiftRuleLimitsSection } from './gift-rule-limits-section';
import { GiftRuleNameSection } from './gift-rule-name-section';
import { GiftRuleNotices } from './gift-rule-notices';
import { GiftRulePeriodSection } from './gift-rule-period-section';
import { GiftRuleRail } from './gift-rule-rail';
import { GiftRuleWhenSection } from './gift-rule-when-section';

/** Vertical-ellipsis glyph on the row menu trigger; the accessible name is the aria-label. */
const MENU_GLYPH = '\u22EF';

export interface GiftRuleComposerProps {
  initial: GiftRuleFormValues;
  /** The saved rule being edited; `null` for a new one. */
  rule: GiftRule | null;
  canWrite: boolean;
  saving: boolean;
  onSave: (values: GiftRuleFormValues, isActive: boolean, extend?: { to: string }) => void;
  onResume: (additionalUnits: number) => void;
  onCopy: () => void;
  /** Deletes the saved rule; absent for a role that cannot. */
  onDelete?: () => void;
  deleting?: boolean;
  saveError: string | null;
}

export function GiftRuleComposer({
  initial,
  rule,
  canWrite,
  saving,
  onSave,
  onResume,
  onCopy,
  onDelete,
  deleting = false,
  saveError,
}: GiftRuleComposerProps): ReactElement {
  const copy = useMessages('gifts');
  const form = useForm<GiftRuleFormValues>({ defaultValues: initial });
  const values = form.watch();
  const [nameTouched, setNameTouched] = useState(initial.name !== '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset only when the thing being edited changes (another rule, or the saved
  // rule's own `updatedAt`), or when the starting values changed under a form the
  // operator has not touched (product names arriving late). A failed save, a
  // refetch or a re-render with the same content must never wipe typed values.
  const { reset, getValues } = form;
  const editedKey = `${rule?.id ?? 'new'}|${rule?.updatedAt ?? ''}`;
  const initialKey = JSON.stringify(initial);
  const lastEditedKey = useRef(editedKey);
  const appliedKey = useRef<string | null>(null);
  useEffect(() => {
    const switched = lastEditedKey.current !== editedKey;
    lastEditedKey.current = editedKey;
    // `setValue` does not mark the form dirty here, so touched means "differs from what was applied".
    const touched = appliedKey.current !== null && JSON.stringify(getValues()) !== appliedKey.current;
    if (!switched && touched) return;
    appliedKey.current = initialKey;
    reset(initial);
    setNameTouched(initial.name !== '');
  }, [editedKey, initialKey, reset, getValues]);

  const problems = validateGiftRuleForm(values);
  const draft = problems.length === 0 ? formToWriteInput(values, true) : null;
  const disabled = !canWrite || saving;

  // The name follows what the operator picked until they type their own.
  const suggested = suggestRuleName(values, copy.composer.nameTemplates);
  useEffect(() => {
    if (!nameTouched && suggested !== '' && suggested !== values.name) {
      form.setValue('name', suggested);
    }
  }, [nameTouched, suggested, values.name, form]);

  const state = rule === null ? 'new' : rule.status;
  const ended = rule?.status === 'ended';
  const isDraftLike = state === 'new' || state === 'inactive';
  const sectionProps = { form, values, readOnly: !canWrite };

  const actions = (
    <ReadOnlyLock active={!canWrite} message={copy.list.readOnly}>
      <span className="gift-detail__actions">
        {isDraftLike ? (
          <Button
            tone="secondary"
            disabled={disabled || problems.length > 0}
            onClick={() => onSave(values, false)}
            data-testid="gift-composer-save-draft"
          >
            {copy.composer.saveDraft}
          </Button>
        ) : rule !== null && !ended ? (
          <Button
            tone="secondary"
            disabled={disabled}
            onClick={() => onSave(values, false)}
            data-testid="gift-composer-pause"
          >
            {copy.composer.pause}
          </Button>
        ) : null}
        <Button
          disabled={disabled || problems.length > 0 || (!isDraftLike && ended === true)}
          onClick={() => onSave(values, true)}
          data-testid="gift-composer-primary"
        >
          {isDraftLike ? copy.composer.turnOn : copy.composer.saveChanges}
        </Button>
        {rule !== null ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                tone="secondary"
                aria-label={copy.detail.actionsMenu}
                data-testid="gift-composer-menu"
              >
                {MENU_GLYPH}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onCopy} data-testid="gift-composer-copy">
                {copy.composer.copy}
              </DropdownMenuItem>
              {onDelete ? (
                <DropdownMenuItem
                  disabled={deleting}
                  onSelect={() => setConfirmingDelete(true)}
                  data-testid="gift-composer-delete"
                >
                  {copy.composer.delete}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </span>
    </ReadOnlyLock>
  );

  return (
    <PageLayout
      eyebrow={copy.list.eyebrow}
      backTo={{
        to: '/automations/gifts',
        label: copy.composer.back,
        'data-testid': 'gift-composer-back',
      }}
      title={
        <span className="gift-detail__title">
          <span data-testid="gift-composer-title">
            {rule === null ? copy.composer.newTitle : rule.name}
          </span>
          {rule !== null ? (
            <StatusBadge tone={RULE_STATE_TONE[ruleStateKey(rule)]} withDot>
              {copy.status[ruleStateKey(rule)]}
            </StatusBadge>
          ) : null}
        </span>
      }
      actions={actions}
    >
      <div className="gift-composer" data-testid="gift-composer">
        <GiftRuleNotices
          rule={rule}
          canWrite={canWrite}
          saving={saving}
          hasProblems={problems.length > 0}
          onResume={onResume}
          onExtend={(to) => onSave(values, true, { to })}
        />
        {problems.length > 0 && values.name.trim() !== '' ? (
          <p className="text-muted" data-testid="gift-composer-missing">
            {copy.composer.missing}: {problems.map((key) => copy.composer.problems[key]).join(', ')}
          </p>
        ) : null}
        {saveError !== null ? (
          <Alert tone="error" data-testid="gift-composer-save-error">
            {saveError}
          </Alert>
        ) : null}

        <div className="order-detail__primary-grid order-detail__primary-grid--split">
          <div className="order-detail__stack">
            <GiftRuleNameSection {...sectionProps} onTyped={() => setNameTouched(true)} />
            <GiftRuleWhenSection {...sectionProps} />
            <GiftRuleGiftSection {...sectionProps} />
            <GiftRuleChannelsSection {...sectionProps} />
            <GiftRulePeriodSection {...sectionProps} />
            <GiftRuleLimitsSection {...sectionProps} />
          </div>
          <div className="order-detail__stack">
            <GiftRuleRail values={values} rule={rule} draft={draft} />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete && rule !== null && onDelete !== undefined}
        onOpenChange={setConfirmingDelete}
        tone="danger"
        title={copy.composer.deleteTitle}
        description={copy.composer.deleteBody}
        confirmLabel={copy.composer.deleteConfirm}
        cancelLabel={copy.composer.deleteKeep}
        isConfirming={deleting}
        onConfirm={() => onDelete?.()}
      />
    </PageLayout>
  );
}
