/**
 * Create / edit sourcing-rule dialog (#3058)
 *
 * The only place a sourcing rule is authored. It owns its own mutations so the
 * page composing it (#3060) supplies a connection and nothing else.
 *
 * ## `kind` is LOCKED on edit, and the lock is not cosmetic
 *
 * `UpdateSourcingRuleDto` carries `position` / `name` / `afterAction` /
 * `priorityLocationIds` / `effectiveFrom` / `effectiveTo` and deliberately NOT
 * `kind`, because kind is half the rule's identity under the duplicate index.
 * A form that let Filter and Sort be flipped would be offering a change the
 * PATCH cannot carry: whatever it sent would be dropped or refused, and the
 * operator would watch a save succeed and change nothing.
 *
 * ## A name already claimed by a LIVE sibling is offered DISABLED, not hidden
 *
 * Only one rule of each `(kind, name)` may be live, and the API answers 409.
 * Disabling with the reason beside it tells the operator the rule they want
 * already exists and points them at it; removing the option would leave them
 * hunting for a capability the product appears not to have. "Live" is the
 * BACKEND's predicate — not-retired, which includes a scheduled rule, because a
 * scheduled rule already holds the slot.
 *
 * ## The splitting preview is derived, and LOOSENING asks first
 *
 * The preview recomputes #3057's ceiling over `rules` with this draft swapped
 * in, so it states the ruleset's answer rather than this rule's own value. A
 * draft that would let orders split MORE than they do today is the one change
 * an operator cannot see the consequence of from the form alone, so it is
 * confirmed rather than warned about. Stricter and unchanged save straight
 * through — an extra click on a safe direction trains people to click through
 * the unsafe one.
 *
 * ## `position` is never an input
 *
 * Order is expressed by the table's arrows (#3057) and by `PUT /order`. A
 * create appends (live count + 1) and an edit keeps the rule's own position,
 * so this dialog can never silently renumber a ruleset the operator was not
 * looking at.
 *
 * @module apps/web/src/features/oms/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import type { SourcingRule } from '../api/sourcing-rules.types';
import { useCreateSourcingRuleMutation } from '../hooks/use-create-sourcing-rule-mutation';
import { useUpdateSourcingRuleMutation } from '../hooks/use-update-sourcing-rule-mutation';
import { describeSourcingRuleError } from '../lib/sourcing-rule-conflict';
import { resolveSplitCeiling } from '../lib/sourcing-rule-ceiling';
import { isLiveSourcingRule } from '../lib/sourcing-rule-status';
import {
  sourcingAfterActionHint,
  sourcingAfterActionLabel,
  sourcingRuleKindHint,
  sourcingRuleNameHint,
  sourcingRuleNameLabel,
} from '../lib/sourcing-rule.copy';
import {
  AFTER_ACTION_PERMISSIVENESS,
  SOURCING_AFTER_ACTION_VALUES,
  SOURCING_FILTER_NAME_VALUES,
  SOURCING_RULE_KIND_VALUES,
  SOURCING_SORT_NAME_VALUES,
  type SourcingRuleKind,
} from '../lib/sourcing-rule-vocabulary';
import {
  PRIORITY_SORT_NAME,
  sourcingRuleFormSchema,
  toDateInputValue,
  toEffectiveInstant,
  type SourcingRuleFormSubmission,
  type SourcingRuleFormValues,
} from './sourcing-rule-dialog.schema';

/** What the dialog needs to render a location; the page supplies it (#3060). */
export interface SourcingRuleLocationOption {
  id: string;
  code: string;
  name: string;
  /** An inactive location stays selectable — it may not receive orders. */
  isActive: boolean;
}

export interface SourcingRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  /** Every rule currently on screen — for the claimed-name check and the preview. */
  rules: readonly SourcingRule[];
  /** Absent = create. */
  rule?: SourcingRule;
  /**
   * Locations the priority list may rank. An EMPTY array is not an error here:
   * the page's own no-locations gate (#3060) decides whether authoring is
   * possible at all, and duplicating that judgement would give it two homes.
   */
  locations: readonly SourcingRuleLocationOption[];
  onSaved?: (rule: SourcingRule) => void;
  now?: Date;
}

const NAMES_BY_KIND: Readonly<Record<SourcingRuleKind, readonly string[]>> = {
  filter: SOURCING_FILTER_NAME_VALUES,
  sort: SOURCING_SORT_NAME_VALUES,
};

function defaultValues(rule: SourcingRule | undefined): SourcingRuleFormValues {
  if (rule === undefined) {
    return {
      kind: 'filter',
      name: SOURCING_FILTER_NAME_VALUES[0],
      afterAction: 'line-split',
      priorityLocationIds: [],
      effectiveFrom: '',
      effectiveTo: '',
    } as SourcingRuleFormValues;
  }

  return {
    kind: rule.kind,
    name: rule.name,
    afterAction: rule.afterAction,
    priorityLocationIds: [...rule.priorityLocationIds],
    effectiveFrom: toDateInputValue(rule.effectiveFrom),
    effectiveTo: toDateInputValue(rule.effectiveTo),
  } as SourcingRuleFormValues;
}

export function SourcingRuleDialog({
  open,
  onOpenChange,
  connectionId,
  rules,
  rule,
  locations,
  onSaved,
  now = new Date(),
}: SourcingRuleDialogProps): ReactElement {
  const isEdit = rule !== undefined;
  const createMutation = useCreateSourcingRuleMutation();
  const updateMutation = useUpdateSourcingRuleMutation();
  const mutation = isEdit ? updateMutation : createMutation;

  const [pendingLoosen, setPendingLoosen] = useState<SourcingRuleFormSubmission | null>(null);

  const form = useForm<SourcingRuleFormValues, undefined, SourcingRuleFormSubmission>({
    defaultValues: defaultValues(rule),
    resolver: zodResolver(sourcingRuleFormSchema),
  });

  // Re-seed when the dialog is re-opened for a different rule: the component is
  // kept mounted by its parent, so without this an edit would render the
  // previous rule's values.
  useEffect(() => {
    if (open) {
      form.reset(defaultValues(rule));
      setPendingLoosen(null);
      createMutation.reset();
      updateMutation.reset();
    }
    // Deliberately keyed on open/target only: including the form or the
    // mutations in the dep list would re-seed on every render and discard the
    // operator's typing.
  }, [open, rule?.id]);

  const kind = form.watch('kind');
  const name = form.watch('name');
  const afterAction = form.watch('afterAction');
  const priorityLocationIds = form.watch('priorityLocationIds');

  /** `(kind, name)` pairs a live sibling already holds. */
  const claimedNames = useMemo(() => {
    const claimed = new Map<string, number>();
    rules.forEach((candidate, index) => {
      if (candidate.id === rule?.id) return;
      if (!isLiveSourcingRule(candidate, now)) return;
      claimed.set(`${candidate.kind}:${candidate.name}`, index + 1);
    });
    return claimed;
  }, [rules, rule?.id, now]);

  const draft = useMemo<SourcingRule>(
    () => ({
      id: rule?.id ?? '__draft__',
      connectionId,
      position: rule?.position ?? rules.length + 1,
      kind,
      name,
      afterAction,
      priorityLocationIds: [...priorityLocationIds],
      effectiveFrom: toEffectiveInstant(form.getValues('effectiveFrom')),
      effectiveTo: toEffectiveInstant(form.getValues('effectiveTo')),
      createdAt: rule?.createdAt ?? new Date(0).toISOString(),
      updatedAt: rule?.updatedAt ?? new Date(0).toISOString(),
      recognised: true,
    }),
    [rule, connectionId, rules.length, kind, name, afterAction, priorityLocationIds, form]
  );

  const ceilingBefore = resolveSplitCeiling(rules, now).ceiling;
  const ceilingAfter = resolveSplitCeiling(
    [...rules.filter((candidate) => candidate.id !== rule?.id), draft],
    now
  ).ceiling;
  const loosens =
    AFTER_ACTION_PERMISSIVENESS[ceilingAfter] > AFTER_ACTION_PERMISSIVENESS[ceilingBefore];
  const stricter =
    AFTER_ACTION_PERMISSIVENESS[ceilingAfter] < AFTER_ACTION_PERMISSIVENESS[ceilingBefore];

  async function save(values: SourcingRuleFormSubmission): Promise<void> {
    const body = {
      name: values.name,
      afterAction: values.afterAction,
      priorityLocationIds: values.priorityLocationIds,
      effectiveFrom: toEffectiveInstant(values.effectiveFrom),
      effectiveTo: toEffectiveInstant(values.effectiveTo),
    };

    const saved = isEdit
      ? await updateMutation.mutateAsync({ connectionId, ruleId: rule.id, ...body })
      : await createMutation.mutateAsync({
          connectionId,
          // Appends. Order is the table's to change, never this form's.
          position: rules.filter((candidate) => isLiveSourcingRule(candidate, now)).length + 1,
          kind: values.kind,
          ...body,
        });

    onSaved?.(saved);
    onOpenChange(false);
  }

  const onSubmit = form.handleSubmit(async (values) => {
    if (loosens) {
      setPendingLoosen(values);
      return;
    }
    try {
      await save(values);
    } catch {
      // Surfaced from `mutation.error` below.
    }
  });

  const nameOptions = NAMES_BY_KIND[kind] ?? [];
  const submitError = mutation.error;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="dialog__content--wide" aria-describedby="sourcing-rule-dialog-subtitle">
          <DialogTitle>{isEdit ? 'Edit sourcing rule' : 'Add sourcing rule'}</DialogTitle>
          <DialogDescription id="sourcing-rule-dialog-subtitle">
            {isEdit
              ? `Rule ${rule.position} — everything above it is checked first.`
              : `This will be rule ${rules.filter((candidate) => isLiveSourcingRule(candidate, now)).length + 1} — everything above it is checked first.`}
          </DialogDescription>

          <form onSubmit={(event) => void onSubmit(event)} noValidate>
            {submitError ? (
              <Alert tone="error">
                {describeSourcingRuleError(submitError, 'The rule could not be saved.')}
              </Alert>
            ) : null}

            <section className="dialog-section">
              <p className="dialog-section__head">What triggers this rule</p>

              <FormField
                label="Type"
                name="kind"
                error={form.formState.errors.kind?.message}
                description={
                  isEdit
                    ? 'Cannot be changed. A rule’s type is part of what identifies it, so switching between Filter and Sort is not an edit — it is a different rule. Delete this one and add a new rule instead.'
                    : (sourcingRuleKindHint(kind) ?? undefined)
                }
              >
                <Select
                  {...form.register('kind')}
                  disabled={isEdit}
                  onChange={(event) => {
                    const nextKind = event.target.value as SourcingRuleKind;
                    form.setValue('kind', nextKind, { shouldValidate: false });
                    // The name vocabulary is kind-specific, so a stale name
                    // would be a pair the server refuses.
                    form.setValue('name', (NAMES_BY_KIND[nextKind]?.[0] ?? '') as never, {
                      shouldValidate: false,
                    });
                    form.setValue('priorityLocationIds', [], { shouldValidate: false });
                  }}
                >
                  {SOURCING_RULE_KIND_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {value === 'filter' ? 'Filter — rule locations out' : 'Sort — rank what is left'}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField
                label="Rule"
                name="name"
                error={form.formState.errors.name?.message}
                description={sourcingRuleNameHint(name) ?? undefined}
              >
                <Select {...form.register('name')}>
                  {nameOptions.map((value) => {
                    const claimedAt = claimedNames.get(`${kind}:${value}`);
                    return (
                      <option key={value} value={value} disabled={claimedAt !== undefined}>
                        {sourcingRuleNameLabel(value)}
                        {claimedAt === undefined ? '' : ` — already active as rule ${claimedAt}`}
                      </option>
                    );
                  })}
                </Select>
              </FormField>

              {name === 'country-served' ? (
                <Alert tone="warning">
                  If you run one warehouse that ships to several countries, this rule rules it out
                  for every order NOT placed in that warehouse&rsquo;s own country — including orders
                  you would normally be happy to ship. It is built for &ldquo;one warehouse per
                  country&rdquo;, not &ldquo;one warehouse serving many&rdquo;.
                </Alert>
              ) : null}
            </section>

            <section className="dialog-section">
              <p className="dialog-section__head">Configure it</p>
              {name === PRIORITY_SORT_NAME ? (
                <Controller
                  control={form.control}
                  name="priorityLocationIds"
                  render={({ field }) => (
                    <FormField
                      label="Location order (highest priority first)"
                      name="priorityLocationIds"
                      error={form.formState.errors.priorityLocationIds?.message}
                      description="Any location you do not add here is used last, after everything on this list."
                    >
                      <PriorityLocationPicker
                        locations={locations}
                        selectedIds={field.value}
                        onChange={field.onChange}
                      />
                    </FormField>
                  )}
                />
              ) : (
                <p className="form-field__description">
                  This rule needs no extra setup.
                </p>
              )}
            </section>

            <section className="dialog-section">
              <p className="dialog-section__head">What happens next</p>

              <FormField
                label="Splitting"
                name="afterAction"
                error={form.formState.errors.afterAction?.message}
                description={sourcingAfterActionHint(afterAction) ?? undefined}
              >
                <Select {...form.register('afterAction')}>
                  {SOURCING_AFTER_ACTION_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {sourcingAfterActionLabel(value)}
                    </option>
                  ))}
                </Select>
              </FormField>

              <Alert tone={loosens ? 'warning' : 'info'}>
                {loosens
                  ? `Based on what you have set here, this would allow MORE splitting overall: ${sourcingAfterActionLabel(ceilingAfter)} instead of today's ${sourcingAfterActionLabel(ceilingBefore)} — no other active rule limits it that tightly.`
                  : stricter
                    ? `Based on what you have set here, this makes splitting stricter overall: ${sourcingAfterActionLabel(ceilingAfter)} (currently ${sourcingAfterActionLabel(ceilingBefore)}).`
                    : `Based on what you have set here, splitting stays the same overall: ${sourcingAfterActionLabel(ceilingAfter)}.`}
              </Alert>

              <div className="form-field-row">
                <FormField
                  label="Starts on (optional)"
                  name="effectiveFrom"
                  error={form.formState.errors.effectiveFrom?.message}
                >
                  <Input type="date" {...form.register('effectiveFrom')} />
                </FormField>
                <FormField
                  label="Ends on (optional)"
                  name="effectiveTo"
                  error={form.formState.errors.effectiveTo?.message}
                  description="Setting this to a past date retires the rule while keeping it for history."
                >
                  <Input type="date" {...form.register('effectiveTo')} />
                </FormField>
              </div>
            </section>

            <DialogFooter>
              <Button tone="secondary" type="button" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Save rule'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingLoosen !== null}
        onOpenChange={(next) => {
          if (!next) setPendingLoosen(null);
        }}
        title="Allow more splitting than today?"
        description={`No other active rule currently limits splitting to ${sourcingAfterActionLabel(ceilingBefore)}. Once you save, orders may be split more than they are today (up to ${sourcingAfterActionLabel(ceilingAfter)}).`}
        confirmLabel="Save anyway"
        isConfirming={mutation.isPending}
        className="dialog__content--elevated"
        overlayClassName="dialog__overlay--elevated"
        initialFocus="cancel"
        onConfirm={() => {
          const values = pendingLoosen;
          if (values === null) return;
          setPendingLoosen(null);
          void save(values).catch(() => {
            // Surfaced from `mutation.error` on the form behind this dialog.
          });
        }}
      />
    </>
  );
}

interface PriorityLocationPickerProps {
  locations: readonly SourcingRuleLocationOption[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/**
 * An ORDERED list, which is why it is not a multi-select.
 *
 * The list's order IS the ranking, so the control has to express "move up" and
 * "move down" — the same arrows the table uses (#3055 § Decisions), for the same
 * reason: no DnD library, and no promise of an interaction nothing backs.
 *
 * A selected id with no matching location is rendered as a STALE entry rather
 * than dropped. The location was deleted after the rule was saved; it ranks
 * nothing, and silently removing it would hide that from the operator and quietly
 * change what the rule does on the next save.
 */
function PriorityLocationPicker({
  locations,
  selectedIds,
  onChange,
  ...controlProps
}: PriorityLocationPickerProps): ReactElement {
  const available = locations.filter((location) => !selectedIds.includes(location.id));

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= selectedIds.length) return;
    const next = [...selectedIds];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);
    onChange(next);
  }

  return (
    <div className="priority-picker" {...controlProps}>
      <ul className="priority-picker__rows">
        {selectedIds.map((id, index) => {
          const location = locations.find((candidate) => candidate.id === id);
          const label =
            location === undefined
              ? 'No location exists for this entry — it ranks nothing'
              : `${location.code} · ${location.name}`;

          return (
            <li
              key={id}
              className={[
                'priority-picker__row',
                location === undefined ? 'priority-picker__row--stale' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="priority-picker__pos">{index + 1}</span>
              <span className="priority-picker__label">{label}</span>
              {location !== undefined && !location.isActive ? (
                <span className="priority-picker__note">Inactive</span>
              ) : null}
              <button
                type="button"
                className="button button--ghost button--icon button--sm"
                title={`Move ${label} up`}
                aria-label={`Move ${label} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <span aria-hidden="true">▲</span>
              </button>
              <button
                type="button"
                className="button button--ghost button--icon button--sm"
                title={`Move ${label} down`}
                aria-label={`Move ${label} down`}
                disabled={index === selectedIds.length - 1}
                onClick={() => move(index, 1)}
              >
                <span aria-hidden="true">▼</span>
              </button>
              <button
                type="button"
                className="button button--ghost button--icon button--sm"
                title={`Remove ${label}`}
                aria-label={`Remove ${label}`}
                onClick={() => onChange(selectedIds.filter((candidate) => candidate !== id))}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          );
        })}
      </ul>

      <Select
        value=""
        aria-label="Add a location to the priority list"
        onChange={(event) => {
          if (event.target.value === '') return;
          onChange([...selectedIds, event.target.value]);
        }}
      >
        <option value="">
          {available.length === 0 ? 'No more locations to add' : 'Add a location…'}
        </option>
        {available.map((location) => (
          <option key={location.id} value={location.id}>
            {location.code} · {location.name}
            {location.isActive ? '' : ' (inactive)'}
          </option>
        ))}
      </Select>
    </div>
  );
}
