/**
 * RoutingParcelDialog (#3652)
 *
 * Edits one routing rule's default parcel (size template, box in cm, weight in
 * kg). Values are staged into the panel's draft state on Apply and only sent
 * with "Save routing". An empty draft clears the profile.
 *
 * @module apps/web/src/features/mappings/components
 */
import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
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
import {
  PARCEL_TEMPLATE_OPTIONS,
  isDraftEmpty,
  validateDraft,
  type ParcelProfileDraft,
} from '../lib/parcel-profile';
import { PARCEL_COPY } from '../lib/parcel-profile.copy';

interface RoutingParcelDialogProps {
  open: boolean;
  methodLabel: string;
  initial: ParcelProfileDraft;
  onApply: (draft: ParcelProfileDraft) => void;
  onOpenChange: (open: boolean) => void;
}

export function RoutingParcelDialog({
  open,
  methodLabel,
  initial,
  onApply,
  onOpenChange,
}: RoutingParcelDialogProps): ReactElement {
  const [draft, setDraft] = useState<ParcelProfileDraft>(initial);
  const [error, setError] = useState<string | null>(null);

  const set =
    (field: keyof ParcelProfileDraft) =>
    (value: string): void => {
      setDraft((prev) => ({ ...prev, [field]: value }));
      setError(null);
    };

  // Keep a stored size code this build does not list selectable, so opening
  // the dialog never silently rewrites it.
  const templateOptions: string[] = [...PARCEL_TEMPLATE_OPTIONS];
  if (draft.template !== '' && !templateOptions.includes(draft.template)) {
    templateOptions.push(draft.template);
  }

  function handleApply(): void {
    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    onApply(draft);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="routing-parcel-desc">
        <DialogTitle>{PARCEL_COPY.sectionTitle}</DialogTitle>
        <DialogDescription id="routing-parcel-desc">
          {methodLabel}. {PARCEL_COPY.sectionHint}
        </DialogDescription>

        <FormField label={PARCEL_COPY.templateLabel} name="parcelTemplate">
          <Select value={draft.template} onChange={(e) => set('template')(e.target.value)}>
            <option value="">{PARCEL_COPY.templateNone}</option>
            {templateOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </FormField>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <FormField label={PARCEL_COPY.lengthLabel} name="parcelLength">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={draft.lengthCm}
              onChange={(e) => set('lengthCm')(e.target.value)}
            />
          </FormField>
          <FormField label={PARCEL_COPY.widthLabel} name="parcelWidth">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={draft.widthCm}
              onChange={(e) => set('widthCm')(e.target.value)}
            />
          </FormField>
          <FormField label={PARCEL_COPY.heightLabel} name="parcelHeight">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={draft.heightCm}
              onChange={(e) => set('heightCm')(e.target.value)}
            />
          </FormField>
        </div>

        <FormField label={PARCEL_COPY.weightLabel} name="parcelWeight">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={draft.weightKg}
            onChange={(e) => set('weightKg')(e.target.value)}
          />
        </FormField>

        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            tone="ghost"
            onClick={() => {
              setDraft({ template: '', lengthCm: '', widthCm: '', heightCm: '', weightKg: '' });
              setError(null);
            }}
            disabled={isDraftEmpty(draft)}
          >
            {PARCEL_COPY.clearAction}
          </Button>
          <Button
            tone="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {PARCEL_COPY.cancelAction}
          </Button>
          <Button tone="primary" onClick={handleApply}>
            {PARCEL_COPY.applyAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
