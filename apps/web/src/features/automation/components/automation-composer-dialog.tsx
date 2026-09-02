/**
 * The automation composer (#2365, spec §5.5)
 *
 * `when / only if / then`, mirroring `sales-document-rule-composer-dialog.tsx`
 * in INTERACTION model — AND-only closed-vocabulary conditions with
 * `+ Add condition`, the same footer sentence pattern, the same validation
 * posture — while using the documented state library (RHF + Zod), which that
 * reference predates. `frontend-architecture.md` § Form State pins form state to
 * React Hook Form; the reference's `useState` is a pre-existing deviation, not a
 * precedent.
 *
 * Five properties are load-bearing.
 *
 * **The frontend holds no legality matrix.** Actions and condition fields come
 * from `vocabulary.triggers[]` for the selected trigger. The frontend holds no
 * copy of §5.4.
 *
 * **Rule-level facts render once.** The non-retroactivity sentence and the
 * stop-on-first-failure sentence are properties of the rule, not of any step, so
 * each appears once. Repeating either per row states N times something true once.
 *
 * **The cap is the server's.** `vocabulary.stepBounds.max`, never a literal 3 —
 * a hardcoded cap is a second declaration that can disagree with
 * `AUTOMATION_ACTION_MAX_STEPS`. The vocabulary query is already long-lived, so
 * reading it costs no extra fetch.
 *
 * **A refusal lands on the row that caused it.** Three of the eight backend
 * refusals carry an `index`; `describeAutomationWriteError` reads it and
 * `setError` marks that row, with the rule-level message rendered once above.
 * § Form State asks for exactly this where practical, and an index into a field
 * array is as practical as it gets.
 *
 * **A draft row keeps every slot.** Switching a condition's `field` must not
 * destroy what the operator typed, so the draft is flat and
 * `toConditionInput` / `toActionInput` project the wire shape at submit — one
 * place, so it cannot disagree with itself.
 *
 * No priority field, deliberately (spec §5.5).
 *
 * @module apps/web/src/features/automation/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Dialog, DialogContent, DialogTitle } from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useConnectionsQuery, type Connection } from '../../connections';
import { AUTOMATION_COMPOSER_COPY } from '../lib/automation.copy';
import { describeTrigger } from '../lib/automation-trigger-labels';
import { describeAutomationWriteError } from '../lib/automation-write-error';
import {
  automationComposerSchema,
  newActionDraft,
  newConditionDraft,
  toActionInput,
  toConditionInput,
  type AutomationActionDraft,
  type AutomationComposerValues,
} from '../lib/automation-composer.schema';
import { useCreateAutomationMutation } from '../hooks/use-create-automation-mutation';
import { useEvaluateAutomationMutation } from '../hooks/use-evaluate-automation-mutation';
import {
  draftNeedsDryRun,
  fingerprintDraft,
  resolveDryRunGate,
} from '../lib/dry-run-verdict';
import { AutomationDryRunPanel } from './automation-dry-run-panel';
import { AUTOMATION_DRY_RUN_COPY } from '../lib/automation.copy';
import { AutomationConditionRow } from './automation-condition-row';
import { AutomationActionRow } from './automation-action-row';
import {
  AUTOMATION_CARRIER_CAPABILITY,
  type AutomationTrigger,
  type AutomationVocabulary,
} from '../api/automation.types';

export interface AutomationComposerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: AutomationTrigger;
  vocabulary: AutomationVocabulary;
  /** Pre-fill the §5.1 suggested rule (T5 → A2 → A3), inactive. */
  prefillSuggested?: boolean;
}

/**
 * Carrier accounts for A2.
 *
 * `ShippingProviderManager` is a MANIFEST capability, not a `CoreCapabilityValues`
 * member — capability is open at the registry boundary (#576), and
 * `adapter.types.spec.ts` asserts the plausible-looking `'ShippingProvider'` is
 * NOT a core capability. Mirrors `selectInvoicingCandidates`: active only,
 * stable order.
 */
export function selectCarrierConnections(connections: readonly Connection[]): Connection[] {
  return connections
    .filter(
      (connection) =>
        connection.status === 'active' &&
        connection.enabledCapabilities.includes(AUTOMATION_CARRIER_CAPABILITY),
    )
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The steps a fresh composer opens with.
 *
 * The §5.1 suggestion seeds A2 → A3, but only where the matrix allows them: a
 * suggestion that submits an illegal pair is worse than no suggestion. Anything
 * filtered out leaves the default step rather than an empty list, because a rule
 * with zero steps is refused server-side.
 */
export function seedActions(
  legalActions: readonly string[],
  prefillSuggested: boolean,
): AutomationActionDraft[] {
  if (prefillSuggested) {
    const seeded = ['dispatch-shipment', 'relay-status-to-source']
      .filter((action) => legalActions.includes(action))
      .map((action) => ({ ...newActionDraft(), action }) as AutomationActionDraft);
    if (seeded.length > 0) return seeded;
  }
  const first = newActionDraft();
  if (legalActions.includes(first.action)) return [first];
  const fallback = legalActions[0];
  return [
    fallback === undefined ? first : ({ ...first, action: fallback } as AutomationActionDraft),
  ];
}

export function AutomationComposerDialog({
  open,
  onOpenChange,
  trigger,
  vocabulary,
  prefillSuggested = false,
}: AutomationComposerDialogProps): ReactElement {
  const connectionsQuery = useConnectionsQuery();
  const createRule = useCreateAutomationMutation();

  const triggerVocab = vocabulary.triggers.find((entry) => entry.value === trigger);
  const legalActions = useMemo(() => triggerVocab?.legalActions ?? [], [triggerVocab]);
  const legalFields = triggerVocab?.legalConditionFields ?? [];
  const maxSteps = vocabulary.stepBounds.max;
  const configKey = triggerVocab?.configKey ?? null;

  const form = useForm<AutomationComposerValues>({
    resolver: zodResolver(automationComposerSchema),
    defaultValues: {
      name: '',
      trigger,
      triggerConfigValue: '24',
      conditions: [],
      actions: seedActions(legalActions, prefillSuggested),
      isActive: false,
      moneyAcknowledged: false,
      effectiveFrom: today(),
      effectiveTo: '',
    },
  });

  const { control, formState, handleSubmit, register, reset, setError, setValue, watch } = form;
  // `reset` on a TanStack mutation is stable, so it can sit in the effect deps
  // instead of the whole mutation object (which changes every render).
  const resetMutation = createRule.reset;
  const conditionArray = useFieldArray({ control, name: 'conditions' });
  const actionArray = useFieldArray({ control, name: 'actions' });

  const conditions = watch('conditions');
  const actions = watch('actions');
  const isActive = watch('isActive');
  const moneyAcknowledged = watch('moneyAcknowledged');
  const triggerConfigValue = watch('triggerConfigValue');

  const evaluate = useEvaluateAutomationMutation();
  // The draft the dry run was evidence FOR. Session-scoped and short-lived: it
  // is cleared with the form, because evidence about a discarded draft is
  // evidence about nothing.
  const [testedFingerprint, setTestedFingerprint] = useState<string | null>(null);

  const currentFingerprint = fingerprintDraft({
    trigger,
    triggerConfigValue,
    conditions,
    actions,
  });
  // Keyed on `irreversible` ALONE — never `isActive && irreversible`. See
  // `draftNeedsDryRun` for why gating on arming is bypassable in two clicks.
  const needsDryRun = draftNeedsDryRun(actions, vocabulary.actions);
  const gate = resolveDryRunGate({ needsDryRun, testedFingerprint, currentFingerprint });
  const resetEvaluate = evaluate.reset;

  const carriers = selectCarrierConnections(connectionsQuery.data ?? []);
  const allConnections = connectionsQuery.data ?? [];

  // Re-seed each time the dialog opens. The draft is deliberately short-lived —
  // § Local UI State: "wizard step inside one composed flow".
  useEffect(() => {
    if (!open) return;
    reset({
      name: '',
      trigger,
      triggerConfigValue: '24',
      conditions: [],
      actions: seedActions(legalActions, prefillSuggested),
      isActive: false,
      moneyAcknowledged: false,
      effectiveFrom: today(),
      effectiveTo: '',
    });
    resetMutation();
    resetEvaluate();
    setTestedFingerprint(null);
  }, [open, prefillSuggested, trigger, legalActions, reset, resetMutation, resetEvaluate]);

  const refusal = createRule.error ? describeAutomationWriteError(createRule.error) : null;

  // An action the vocabulary does not recognise is NOT treated as irreversible:
  // demanding an acknowledgement for a step this build cannot classify would ask
  // the operator to consent to something neither side can name. The backend
  // applies its own gate regardless, so the refusal still surfaces if we are
  // wrong.
  const hasIrreversibleAction = actions.some(
    (draft) =>
      vocabulary.actions.find((entry) => entry.action === draft.action)?.irreversible === true,
  );
  const needsMoneyAck = isActive && hasIrreversibleAction;

  function onSubmit(values: AutomationComposerValues): void {
    void createRule
      .mutateAsync({
        name: values.name.trim(),
        trigger,
        triggerConfig:
          configKey === null ? {} : { [configKey]: Number(values.triggerConfigValue) || 0 },
        conditions: values.conditions.map(toConditionInput),
        actions: values.actions.map(toActionInput),
        isActive: values.isActive,
        effectiveFrom: values.effectiveFrom,
        effectiveTo: values.effectiveTo.trim().length > 0 ? values.effectiveTo : null,
        // Sent only when it is actually required — the backend ignores an
        // acknowledgement for a decision nobody made rather than stamping it.
        ...(needsMoneyAck ? { moneyAcknowledged: values.moneyAcknowledged } : {}),
      })
      .then(() => onOpenChange(false))
      .catch((error: unknown) => {
        // Mark the row the server named. The banner still renders the sentence
        // once above; this is what makes the row findable in a long form.
        const parsed = describeAutomationWriteError(error);
        if (parsed.target === null || parsed.index === null) return;
        // The DISCRIMINANT select, not a parameter slot: `carrierId` renders
        // only for `dispatch-shipment` and `value` only for the non-amount
        // condition fields, so targeting those would mark a field the row does
        // not render — an invisible error, which is no mapping at all.
        const path =
          parsed.target === 'conditions'
            ? (`conditions.${parsed.index}.field` as const)
            : (`actions.${parsed.index}.action` as const);
        setError(path, { type: 'server', message: parsed.message });
      });
  }

  const described = describeTrigger(trigger);
  const conditionErrors = formState.errors.conditions;
  const actionErrors = formState.errors.actions;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="automation-composer"
        style={{ maxWidth: '40rem' }}
      >
        <DialogTitle>{AUTOMATION_COMPOSER_COPY.createTitle}</DialogTitle>

        {refusal === null ? null : (
          <Alert tone="error" title={AUTOMATION_COMPOSER_COPY.saveFailed}>
            {refusal.message}
          </Alert>
        )}

        <form
          className="automation-composer__form"
          onSubmit={(event) => {
            void handleSubmit(onSubmit)(event);
          }}
        >
          <FormField
            label={AUTOMATION_COMPOSER_COPY.nameLabel}
            name="automation-name"
            error={formState.errors.name?.message}
            description={AUTOMATION_COMPOSER_COPY.nameHint}
          >
            <Input {...register('name')} />
          </FormField>

          <section className="automation-composer__section">
            <p className="eyebrow">{AUTOMATION_COMPOSER_COPY.whenLabel}</p>
            <p>{described.label}</p>
            {configKey === null ? null : (
              <FormField
                label={AUTOMATION_COMPOSER_COPY.triggerConfigLabel}
                name="automation-trigger-config"
                error={formState.errors.triggerConfigValue?.message}
              >
                <Input type="number" min={1} {...register('triggerConfigValue')} />
              </FormField>
            )}
          </section>

          <section className="automation-composer__section">
            <p className="eyebrow">{AUTOMATION_COMPOSER_COPY.onlyIfLabel}</p>
            {conditionArray.fields.map((field, index) => (
              <AutomationConditionRow
                key={field.id}
                index={index}
                draft={conditions[index] ?? newConditionDraft()}
                legalFields={legalFields}
                holdReasons={vocabulary.holdReasons}
                connections={allConnections}
                errors={{
                  field: conditionErrors?.[index]?.field?.message,
                  value: conditionErrors?.[index]?.value?.message,
                  amount: conditionErrors?.[index]?.amount?.message,
                  currency: conditionErrors?.[index]?.currency?.message,
                }}
                register={register}
                setValue={setValue}
                onRemove={() => conditionArray.remove(index)}
              />
            ))}
            <Button
              type="button"
              tone="secondary"
              className="button--sm"
              onClick={() => conditionArray.append(newConditionDraft())}
            >
              {AUTOMATION_COMPOSER_COPY.addCondition}
            </Button>
            <p className="muted-text">{AUTOMATION_COMPOSER_COPY.conditionsHint}</p>
          </section>

          <section className="automation-composer__section">
            <p className="eyebrow">{AUTOMATION_COMPOSER_COPY.thenLabel}</p>
            {actionArray.fields.map((field, index) => (
              <AutomationActionRow
                key={field.id}
                index={index}
                draft={actions[index] ?? newActionDraft()}
                legalActions={legalActions}
                actionVocabulary={vocabulary.actions}
                holdReasons={vocabulary.holdReasons}
                carriers={carriers}
                errors={{
                  action: actionErrors?.[index]?.action?.message,
                  carrierId: actionErrors?.[index]?.carrierId?.message,
                  address: actionErrors?.[index]?.address?.message,
                  body: actionErrors?.[index]?.body?.message,
                  holdReason: actionErrors?.[index]?.holdReason?.message,
                  note: actionErrors?.[index]?.note?.message,
                }}
                register={register}
                onAppendToBody={(token) => {
                  // Appends rather than inserting at the caret — a deliberate v1
                  // limit, noted in `AutomationMergeFields`.
                  const current = actions[index]?.body ?? '';
                  setValue(`actions.${index}.body`, `${current}${token}`, { shouldDirty: true });
                }}
                onRemove={() => actionArray.remove(index)}
                canRemove={actionArray.fields.length > 1}
              />
            ))}
            <Button
              type="button"
              tone="secondary"
              className="button--sm"
              disabled={actionArray.fields.length >= maxSteps}
              onClick={() => actionArray.append(newActionDraft())}
            >
              {AUTOMATION_COMPOSER_COPY.addAction}
            </Button>
            {formState.errors.actions?.root?.message ? (
              <p className="field-error">{formState.errors.actions.root.message}</p>
            ) : null}
            {/* Once, for the rule — never per step. */}
            <p className="muted-text">
              {AUTOMATION_COMPOSER_COPY.stopOnFirstFailure(maxSteps)}
            </p>
          </section>

          <div className="automation-composer__dates">
            <FormField
              label={AUTOMATION_COMPOSER_COPY.effectiveFromLabel}
              name="automation-effective-from"
              error={formState.errors.effectiveFrom?.message}
            >
              <Input type="date" {...register('effectiveFrom')} />
            </FormField>
            <FormField
              label={`${AUTOMATION_COMPOSER_COPY.effectiveToLabel} ${AUTOMATION_COMPOSER_COPY.effectiveToOptional}`}
              name="automation-effective-to"
            >
              <Input type="date" {...register('effectiveTo')} />
            </FormField>
          </div>

          <label className="ack-row">
            <input type="checkbox" {...register('isActive')} />
            <span>
              {AUTOMATION_COMPOSER_COPY.activeLabel}
              <span className="muted-text" style={{ display: 'block' }}>
                {AUTOMATION_COMPOSER_COPY.activeHint}
              </span>
            </span>
          </label>

          {/*
            Only when ARMING a rule with an irreversible step — the backend
            refuses that write without it, so asking only after the operator
            filled the whole form would be the gate inverted.
          */}
          {needsMoneyAck ? (
            <label className="ack-row">
              <input type="checkbox" {...register('moneyAcknowledged')} />
              <span>{AUTOMATION_COMPOSER_COPY.moneyAckLabel}</span>
            </label>
          ) : null}

          {/*
            The §5.6a arming gate. Rendered whenever the draft carries an
            irreversible step, regardless of whether it is being armed — the
            evidence is needed to CREATE the definition, so no later path can
            arm it untested.
          */}
          {needsDryRun ? (
            <>
              <AutomationDryRunPanel
                isRunning={evaluate.isPending}
                result={evaluate.data ?? null}
                error={evaluate.error}
                // The gate already knows the result no longer describes the
                // current draft; without telling the panel, a green verdict for
                // a rule that no longer exists stays on screen under the
                // "test it again" banner.
                isStale={gate === 'stale'}
                onRun={(orderId) => {
                  const values = form.getValues();
                  const fingerprint = fingerprintDraft({
                    trigger,
                    triggerConfigValue: values.triggerConfigValue,
                    conditions: values.conditions,
                    actions: values.actions,
                  });
                  void evaluate
                    .mutateAsync({
                      orderId,
                      // Always the DRAFT arm: a draft has no id, and sending
                      // both `ruleId` and `rule` is a 400.
                      rule: {
                        name: values.name.trim().length > 0 ? values.name.trim() : 'Untitled',
                        trigger,
                        triggerConfig:
                          configKey === null
                            ? {}
                            : { [configKey]: Number(values.triggerConfigValue) || 0 },
                        conditions: values.conditions.map(toConditionInput),
                        actions: values.actions.map(toActionInput),
                        isActive: values.isActive,
                        effectiveFrom: values.effectiveFrom,
                        effectiveTo:
                          values.effectiveTo.trim().length > 0 ? values.effectiveTo : null,
                      },
                    })
                    // The fingerprint is stamped only on a SUCCESSFUL run: a
                    // refused evaluation is not evidence of anything.
                    .then(() => setTestedFingerprint(fingerprint))
                    .catch(() => {
                      setTestedFingerprint(null);
                    });
                }}
              />
              {gate === 'required' ? (
                <Alert tone="warning">{AUTOMATION_DRY_RUN_COPY.gateLocked}</Alert>
              ) : null}
              {/*
                "Not tested" and "tested, then changed" are different operator
                situations; one sentence for both reads as the gate being broken.
              */}
              {gate === 'stale' ? (
                <Alert tone="warning">{AUTOMATION_DRY_RUN_COPY.gateStale}</Alert>
              ) : null}
              {gate === 'satisfied' ? (
                <p className="muted-text">{AUTOMATION_DRY_RUN_COPY.gatePassed}</p>
              ) : null}
            </>
          ) : null}

          {/* Spec §5.5, verbatim — once, for the rule. */}
          <p className="muted-text">{AUTOMATION_COMPOSER_COPY.nonRetroactivity}</p>

          <div className="automation-composer__footer">
            <Button type="button" tone="secondary" onClick={() => onOpenChange(false)}>
              {AUTOMATION_COMPOSER_COPY.cancel}
            </Button>
            <Button
              type="submit"
              disabled={
                createRule.isPending ||
                (needsMoneyAck && !moneyAcknowledged) ||
                gate === 'required' ||
                gate === 'stale'
              }
            >
              {createRule.isPending
                ? AUTOMATION_COMPOSER_COPY.saving
                : AUTOMATION_COMPOSER_COPY.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
