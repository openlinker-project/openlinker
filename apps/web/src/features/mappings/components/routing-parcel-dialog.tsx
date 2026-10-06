/**
 * RoutingParcelDialog (#3652)
 *
 * Edits one routing rule's default parcel (size template - a listed size or a
 * typed carrier code - box in cm, weight in kg). Values are staged into the panel's draft state on Apply and only sent
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
  isListedParcelTemplate,
  validateDraft,
  type ParcelProfileDraft,
} from '../lib/parcel-profile';
import { PARCEL_COPY } from '../lib/parcel-profile.copy';

// Select value for the free-text escape hatch. It never reaches the draft: the
// draft's `template` holds the typed code, the select only tracks the mode.
const OTHER_TEMPLATE_OPTION = '__other__';

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
  // A stored code outside the listed sizes opens in free-text mode, so opening
  // the dialog never silently rewrites it.
  const [customTemplate, setCustomTemplate] = useState<boolean>(
    initial.template !== '' && !isListedParcelTemplate(initial.template)
  );
  const [error, setError] = useState<string | null>(null);

  const set =
    (field: keyof ParcelProfileDraft) =>
    (value: string): void => {
      setDraft((prev) => ({ ...prev, [field]: value }));
      setError(null);
    };

  function handleTemplateSelect(value: string): void {
    if (value === OTHER_TEMPLATE_OPTION) {
      setCustomTemplate(true);
      set('template')('');
      return;
    }
    setCustomTemplate(false);
    set('template')(value);
  }

  function handleApply(): void {
    const problem = validateDraft(draft, { customTemplate });
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
          <Select
            value={customTemplate ? OTHER_TEMPLATE_OPTION : draft.template}
            onChange={(e) => handleTemplateSelect(e.target.value)}
          >
            <option value="">{PARCEL_COPY.templateNone}</option>
            {PARCEL_TEMPLATE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={OTHER_TEMPLATE_OPTION}>{PARCEL_COPY.templateOther}</option>
          </Select>
        </FormField>

        {customTemplate && (
          <FormField label={PARCEL_COPY.customTemplateLabel} name="parcelTemplateCode">
            <Input value={draft.template} onChange={(e) => set('template')(e.target.value)} />
          </FormField>
        )}

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
              setCustomTemplate(false);
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
