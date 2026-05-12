/**
 * OfferCreationLauncher
 *
 * Capability-shaped entry-point for the "Create offer" CTA on the listings
 * page (#608). Owns:
 *   - the surrounding `<Dialog>` chrome
 *   - the connection-picking state (which marketplace to publish to)
 *   - dispatch to the per-platform wizard registered against the FE
 *     plugin registry via `useOfferCreationWizard(platformType)`
 *
 * The launcher renders a **single morphing Dialog**:
 *   1. picker body when no connection is chosen yet
 *   2. plugin-contributed wizard body once the connection resolves to a
 *      platform that has a registered wizard
 *   3. an "unsupported marketplace" alert when no plugin contributes
 *
 * Auto-skip: if `defaultConnectionId` is supplied (retry path) **and**
 * resolves to an active marketplace connection, the picker is skipped and
 * the wizard renders directly. While the connections query is still
 * loading, an inline loading state is shown inside the dialog.
 *
 * @module apps/web/src/features/listings/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { useOfferCreationWizard } from '../../../app/plugin-bindings/use-offer-creation-wizard';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Select } from '../../../shared/ui/select';
import { useConnectionsQuery } from '../../connections';
import type { Connection } from '../../connections';
import type { CreateOfferRequest } from '../api/listings.types';

interface OfferCreationLauncherProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-selected connection id (e.g. retry path). When this resolves
   *  against the loaded connection list, the picker is skipped. */
  defaultConnectionId?: string;
  initialValues?: CreateOfferRequest;
  onSubmitted: (offerCreationRecordId: string, connectionId: string) => void;
}

/**
 * Marketplace connections eligible for offer creation. Filters by the
 * `OfferManager` capability (#578/#579) — the previous `platformType ===
 * 'allegro'` grandfather arm was a transitional backstop for connections
 * registered before #570/#571 wired adapter metadata; every Allegro
 * connection now reports `OfferManager` in `supportedCapabilities`. Once
 * the BE exposes `OfferCreator` capability metadata to the FE (#573/#574
 * follow-up) this should narrow to that specifically.
 */
function selectMarketplaceConnections(all: ReadonlyArray<Connection>): Connection[] {
  return all
    .filter((c) => c.status === 'active' && c.supportedCapabilities.includes('OfferManager'))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function OfferCreationLauncher({
  isOpen,
  onClose,
  defaultConnectionId,
  initialValues,
  onSubmitted,
}: OfferCreationLauncherProps): ReactElement | null {
  const connectionsQuery = useConnectionsQuery();
  const marketplaceConnections = useMemo(
    () => selectMarketplaceConnections(connectionsQuery.data ?? []),
    [connectionsQuery.data],
  );

  // Selected connection drives both the dispatch lookup and the wizard
  // mount. Stays null until the operator (or the auto-pick effect) makes
  // a choice — so closing the dialog and reopening lands back at the picker
  // (unless the auto-pick fires again).
  const [pickedConnectionId, setPickedConnectionId] = useState<string | null>(null);
  // Form-local draft for the picker `<Select>` — separated from the
  // commit (`pickedConnectionId`) so the operator can dismiss the dialog
  // without leaving a stale half-pick behind on next open.
  const [pickerDraft, setPickerDraft] = useState<string>('');

  // Reset picker state every time the dialog closes — guarantees a fresh
  // open starts from "no choice yet" rather than carrying the previous
  // operator's selection.
  useEffect(() => {
    if (!isOpen) {
      setPickedConnectionId(null);
      setPickerDraft('');
    }
  }, [isOpen]);

  // Auto-skip path: if a default connection id was supplied and it
  // resolves against the loaded marketplace list, commit it directly so
  // the wizard mounts without an intermediate picker step. Fires exactly
  // once per (defaultConnectionId, connections-loaded) transition.
  useEffect(() => {
    if (!isOpen || pickedConnectionId !== null) return;
    if (!defaultConnectionId) return;
    if (marketplaceConnections.length === 0) return;
    if (marketplaceConnections.some((c) => c.id === defaultConnectionId)) {
      setPickedConnectionId(defaultConnectionId);
    }
    // `pickedConnectionId` is intentionally excluded from the deps array
    // — the early-out above guards run-once behaviour; re-including it
    // would just re-fire the effect with no net effect.
  }, [isOpen, defaultConnectionId, marketplaceConnections]);

  const pickedConnection =
    pickedConnectionId !== null
      ? marketplaceConnections.find((c) => c.id === pickedConnectionId) ?? null
      : null;

  const wizardContribution = useOfferCreationWizard(pickedConnection?.platformType);

  if (!isOpen) {
    return null;
  }

  // Branch the dialog body on launcher state without nesting the wizard
  // inside a second Dialog — one continuous Radix Dialog from picker
  // through to wizard, so no flicker between transitions.
  let body: ReactElement;
  let title: string;
  let description: string | null;

  if (pickedConnection === null) {
    // Loading or picker mode.
    if (connectionsQuery.isLoading) {
      title = 'Create offer';
      description = 'Loading marketplace connections…';
      body = <p className="muted-text">Loading…</p>;
    } else if (marketplaceConnections.length === 0) {
      title = 'Create offer';
      description = null;
      body = (
        <Alert tone="warning" title="No marketplace connections available">
          Add an active connection that supports offer creation before publishing offers.
        </Alert>
      );
    } else {
      title = 'Create offer';
      description = 'Pick the marketplace connection you want to publish this offer to.';
      body = (
        <>
          <FormField label="Connection" name="connection">
            <Select
              value={pickerDraft}
              onChange={(e) => setPickerDraft(e.target.value)}
              aria-label="Marketplace connection"
            >
              <option value="">Choose a connection…</option>
              {marketplaceConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.platformType})
                </option>
              ))}
            </Select>
          </FormField>
          <div className="wizard-actions">
            <div className="wizard-actions__group">
              <Button tone="ghost" type="button" onClick={onClose}>
                Cancel
              </Button>
            </div>
            <div className="wizard-actions__group">
              <Button
                type="button"
                disabled={!pickerDraft}
                onClick={() => setPickedConnectionId(pickerDraft)}
              >
                Continue
              </Button>
            </div>
          </div>
        </>
      );
    }
  } else if (wizardContribution === null) {
    // Unsupported-platform branch.
    title = 'Marketplace not supported';
    description = null;
    const Wizard = null; // suppress unused-variable lint
    void Wizard;
    body = (
      <>
        <Alert tone="warning" title="Offer creation isn't supported for this marketplace yet">
          No plugin contributes an offer-creation wizard for{' '}
          <span className="mono-text">{pickedConnection.platformType}</span>. Choose a different
          connection or install a plugin that handles this platform.
        </Alert>
        <div className="wizard-actions">
          <div className="wizard-actions__group">
            <Button tone="ghost" type="button" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </>
    );
  } else {
    // Wizard branch — the contributed component renders inside our Dialog.
    title = `Create ${pickedConnection.platformType} offer`;
    description = null;
    const Wizard = wizardContribution.component;
    body = (
      <Wizard
        connection={pickedConnection}
        initialValues={initialValues}
        onCancel={onClose}
        onSubmitted={onSubmitted}
      />
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        {description !== null ? <DialogDescription>{description}</DialogDescription> : null}
        {body}
      </DialogContent>
    </Dialog>
  );
}
