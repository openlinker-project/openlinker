/**
 * One step (#2365, spec §5.3b)
 *
 * ## Only legal actions are offered, and legality comes from the API
 *
 * The option list is `vocabulary.triggers[].legalActions` for the selected
 * trigger. The frontend holds no matrix and no copy of §5.4.
 *
 * ## Legal is not runnable, and the row says both
 *
 * A legal action may still be `unavailable` in this build — four of the six
 * are. The selected action carries its availability badge and the backend's own
 * reason, verbatim. It stays offerable because the write path accepts all six by
 * design; what it must never do is read as ready. This is #2364's rule applied
 * one screen earlier, and it is why `/automations/vocabulary` reports
 * availability at all.
 *
 * ## Inputs are REGISTERED, never written through `useFieldArray.update()`
 *
 * See the sibling condition row for the evidence: `update()` remounts the row
 * and swallows the keystroke.
 *
 * @module apps/web/src/features/automation/components
 */
import type { ReactElement } from 'react';
import type { UseFormRegister } from 'react-hook-form';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Textarea } from '../../../shared/ui/textarea';
import { AUTOMATION_ACTION_LABELS, AUTOMATION_COMPOSER_COPY } from '../lib/automation.copy';
import { describeAvailability } from '../lib/action-availability';
import { AutomationMergeFields } from './automation-merge-fields';
import type {
  AutomationActionDraft,
  AutomationComposerValues,
} from '../lib/automation-composer.schema';
import type { AutomationActionVocabulary } from '../api/automation.types';
import type { Connection } from '../../connections';

interface AutomationActionRowProps {
  index: number;
  draft: AutomationActionDraft;
  /** Actions legal for the selected trigger, from the API. */
  legalActions: string[];
  /** Every action's declared availability, from the API. */
  actionVocabulary: AutomationActionVocabulary[];
  holdReasons: string[];
  carriers: Connection[];
  errors: Partial<Record<keyof AutomationActionDraft, string>>;
  register: UseFormRegister<AutomationComposerValues>;
  /** Appends a merge token to this step's body. */
  onAppendToBody: (token: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export function AutomationActionRow({
  index,
  draft,
  legalActions,
  actionVocabulary,
  holdReasons,
  carriers,
  errors,
  register,
  onAppendToBody,
  onRemove,
  canRemove,
}: AutomationActionRowProps): ReactElement {
  const selected = actionVocabulary.find((entry) => entry.action === draft.action);
  const described = selected ? describeAvailability(selected.availability) : null;

  return (
    <div className="automation-composer__action">
      <div className="automation-composer__action-head">
        {/*
          The discriminant, and the one control ALWAYS rendered on this row —
          so a server refusal naming this step lands somewhere the operator can
          actually see, whichever action they picked.
        */}
        <FormField
          label={AUTOMATION_COMPOSER_COPY.actionLabel}
          name={`action-${index}`}
          error={errors.action}
        >
          <Select {...register(`actions.${index}.action`)}>
            {legalActions.map((action) => (
              <option key={action} value={action}>
                {AUTOMATION_ACTION_LABELS[action] ?? action}
              </option>
            ))}
          </Select>
        </FormField>
        {described === null ? null : (
          <StatusBadge tone={described.tone} withDot compact>
            {described.label}
          </StatusBadge>
        )}
        {canRemove ? (
          <Button
            type="button"
            tone="ghost"
            className="button--sm automation-composer__remove"
            onClick={onRemove}
            aria-label={`${AUTOMATION_COMPOSER_COPY.removeAction} ${index + 1}`}
          >
            {AUTOMATION_COMPOSER_COPY.removeAction}
          </Button>
        ) : null}
      </div>

      {/* The backend's own sentence, verbatim — never paraphrased. */}
      {selected?.reason ? <p className="muted-text">{selected.reason}</p> : null}

      {draft.action === 'issue-sales-document' ? (
        <p className="muted-text">{AUTOMATION_COMPOSER_COPY.a1Note}</p>
      ) : null}
      {draft.action === 'relay-status-to-source' ? (
        <p className="muted-text">{AUTOMATION_COMPOSER_COPY.a3Note}</p>
      ) : null}

      {draft.action === 'dispatch-shipment' ? (
        <>
          <Alert tone="warning">{AUTOMATION_COMPOSER_COPY.a2Warning}</Alert>
          <FormField
            label={AUTOMATION_COMPOSER_COPY.carrierLabel}
            name={`action-${index}-carrier`}
            error={errors.carrierId}
            description={AUTOMATION_COMPOSER_COPY.carrierHint}
          >
            <Select {...register(`actions.${index}.carrierId`)}>
              <option value="">Select a carrier…</option>
              {carriers.map((carrier) => (
                <option key={carrier.id} value={carrier.id}>
                  {carrier.name}
                </option>
              ))}
            </Select>
          </FormField>
          {carriers.length === 0 ? (
            <p className="muted-text">{AUTOMATION_COMPOSER_COPY.carrierEmpty}</p>
          ) : null}
          {/* Stated, never rendered as an empty picker — see the copy note. */}
          <p className="muted-text">{AUTOMATION_COMPOSER_COPY.a2NoOptions}</p>
          <label className="ack-row">
            <input type="checkbox" {...register(`actions.${index}.cashOnDelivery`)} />
            <span>{AUTOMATION_COMPOSER_COPY.codLabel}</span>
          </label>
        </>
      ) : null}

      {draft.action === 'send-email' ? (
        <>
          <FormField label={AUTOMATION_COMPOSER_COPY.recipientLabel} name={`action-${index}-to`}>
            <Select {...register(`actions.${index}.recipientKind`)}>
              <option value="address">{AUTOMATION_COMPOSER_COPY.recipientAddress}</option>
              <option value="buyer">{AUTOMATION_COMPOSER_COPY.recipientBuyer}</option>
            </Select>
          </FormField>
          {draft.recipientKind === 'address' ? (
            <FormField
              label={AUTOMATION_COMPOSER_COPY.addressLabel}
              name={`action-${index}-address`}
              error={errors.address}
            >
              <Input type="email" {...register(`actions.${index}.address`)} />
            </FormField>
          ) : null}
          <FormField label={AUTOMATION_COMPOSER_COPY.subjectLabel} name={`action-${index}-subject`}>
            <Input {...register(`actions.${index}.subject`)} />
          </FormField>
          <FormField
            label={AUTOMATION_COMPOSER_COPY.bodyLabel}
            name={`action-${index}-body`}
            error={errors.body}
          >
            <Textarea rows={4} {...register(`actions.${index}.body`)} />
          </FormField>
          <AutomationMergeFields onInsert={onAppendToBody} />
        </>
      ) : null}

      {draft.action === 'place-hold' || draft.action === 'release-hold' ? (
        <>
          <FormField
            label={
              draft.action === 'place-hold'
                ? AUTOMATION_COMPOSER_COPY.holdReasonLabel
                : AUTOMATION_COMPOSER_COPY.releaseWhichLabel
            }
            name={`action-${index}-reason`}
            error={errors.holdReason}
            description={
              draft.action === 'place-hold' ? AUTOMATION_COMPOSER_COPY.holdReasonHint : undefined
            }
          >
            <Select {...register(`actions.${index}.holdReason`)}>
              {/* Empty means "any hold" for A6, and "not chosen" for A5. */}
              <option value="">
                {draft.action === 'release-hold'
                  ? AUTOMATION_COMPOSER_COPY.releaseAnyHold
                  : 'Select a reason…'}
              </option>
              {holdReasons.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label={AUTOMATION_COMPOSER_COPY.noteLabel}
            name={`action-${index}-note`}
            error={errors.note}
            description={
              draft.action === 'release-hold'
                ? AUTOMATION_COMPOSER_COPY.noteRequiredHint
                : undefined
            }
          >
            <Input {...register(`actions.${index}.note`)} />
          </FormField>
        </>
      ) : null}
    </div>
  );
}
