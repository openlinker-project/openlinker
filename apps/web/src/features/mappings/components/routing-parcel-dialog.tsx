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
import {
  isDraftEmpty,
  isListedParcelTemplate,
  validateDraft,
  type ParcelProfileDraft,
} from '../lib/parcel-profile';
import { ParcelProfileForm } from './parcel-profile-form';
import { interpolate, useMessages } from '../../../shared/i18n';

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
  const copy = useMessages('mappings').parcelProfile;
  const [draft, setDraft] = useState<ParcelProfileDraft>(initial);
  // A stored code outside the listed sizes opens in free-text mode, so opening
  // the dialog never silently rewrites it.
  const [customTemplate, setCustomTemplate] = useState<boolean>(
    initial.template !== '' && !isListedParcelTemplate(initial.template)
  );
  const [error, setError] = useState<string | null>(null);

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
        <DialogTitle>{copy.sectionTitle}</DialogTitle>
        <DialogDescription id="routing-parcel-desc">
          {interpolate(copy.sectionHintWithMethod, { method: methodLabel })}
        </DialogDescription>

        <ParcelProfileForm
          draft={draft}
          customTemplate={customTemplate}
          onChange={(next, custom) => {
            setDraft(next);
            setCustomTemplate(custom);
            setError(null);
          }}
        />

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
            {copy.clearAction}
          </Button>
          <Button
            tone="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {copy.cancelAction}
          </Button>
          <Button tone="primary" onClick={handleApply}>
            {copy.applyAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
