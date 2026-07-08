/**
 * ShopPublishLauncher
 *
 * Capability-shaped entry-point for the "Publish to shop" CTA on the
 * listings page (#1044). Owns:
 *   - the surrounding `<Dialog>` chrome
 *   - the shop-connection picking state
 *   - dispatch to the per-platform wizard registered against the FE plugin
 *     registry via `useShopPublishWizard(platformType)`
 *   - swap to `ShopPublishTracker` once the wizard reports a submitted
 *     record / batch
 *
 * Mirrors `OfferCreationLauncher`'s single-morphing-Dialog structure. The
 * launcher renders, in sequence:
 *   1. picker body (skipped when exactly one eligible connection exists)
 *   2. empty state when no `ProductPublisher` connection is configured
 *   3. plugin-contributed wizard once a supported platform resolves
 *   4. an "unsupported platform" warning when no plugin contributes
 *   5. the tracker once the wizard submits
 *
 * @module apps/web/src/features/listings/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { useShopPublishWizard } from '../../../app/plugin-bindings/use-shop-publish-wizard';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../shared/ui/dialog';
import { EmptyState } from '../../../shared/ui/feedback-state';
import { FormField } from '../../../shared/ui/form-field';
import { Link } from 'react-router-dom';
import { Select } from '../../../shared/ui/select';
import { useConnectionsQuery } from '../../connections';
import type { Connection } from '../../connections';
import { ShopPublishTracker } from './ShopPublishTracker';

interface ShopPublishLauncherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultVariantId?: string;
  defaultVariantIds?: string[];
}

/** The capability a connection must enable to publish products to it. */
export const SHOP_PUBLISH_CAPABILITY = 'ProductPublisher';

/**
 * Shop connections eligible for product publishing — active connections that
 * have enabled the `ProductPublisher` capability. Sorted by name for a
 * stable picker order.
 */
export function selectShopPublishConnections(all: ReadonlyArray<Connection>): Connection[] {
  return all
    .filter((c) => c.status === 'active' && c.enabledCapabilities.includes(SHOP_PUBLISH_CAPABILITY))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function ShopPublishLauncher({
  open,
  onOpenChange,
  defaultVariantId,
  defaultVariantIds,
}: ShopPublishLauncherProps): ReactElement | null {
  const connectionsQuery = useConnectionsQuery();
  const shopConnections = useMemo(
    () => selectShopPublishConnections(connectionsQuery.data ?? []),
    [connectionsQuery.data],
  );

  const [pickedConnectionId, setPickedConnectionId] = useState<string | null>(null);
  const [pickerDraft, setPickerDraft] = useState<string>('');
  // After the wizard submits, the launcher swaps content to the tracker.
  const [submitted, setSubmitted] = useState<{
    connectionId: string;
    recordId?: string;
    batchId?: string;
  } | null>(null);

  // Reset all launcher state every time the dialog closes so a fresh open
  // starts clean.
  useEffect(() => {
    if (!open) {
      setPickedConnectionId(null);
      setPickerDraft('');
      setSubmitted(null);
    }
  }, [open]);

  // Auto-skip the picker when there is exactly one eligible connection.
  useEffect(() => {
    if (!open || pickedConnectionId !== null || submitted !== null) return;
    if (shopConnections.length === 1) {
      setPickedConnectionId(shopConnections[0].id);
    }
  }, [open, shopConnections, pickedConnectionId, submitted]);

  const pickedConnection =
    pickedConnectionId !== null
      ? shopConnections.find((c) => c.id === pickedConnectionId) ?? null
      : null;

  const wizardContribution = useShopPublishWizard(pickedConnection?.platformType);

  function close(): void {
    onOpenChange(false);
  }

  if (!open) {
    return null;
  }

  let body: ReactElement;
  let title: string;
  let description: string | null;

  if (submitted !== null) {
    // Tracker mode — owns its own header label inside.
    title = 'Publish to shop';
    description = null;
    body = (
      <>
        <ShopPublishTracker
          connectionId={submitted.connectionId}
          recordId={submitted.recordId}
          batchId={submitted.batchId}
        />
        <div className="wizard-actions">
          <div className="wizard-actions__group">
            <Button type="button" tone="ghost" onClick={close}>
              Close
            </Button>
          </div>
        </div>
      </>
    );
  } else if (pickedConnection === null) {
    if (connectionsQuery.isLoading) {
      title = 'Publish to shop';
      description = 'Loading shop connections…';
      body = <p className="muted-text">Loading…</p>;
    } else if (shopConnections.length === 0) {
      title = 'Publish to shop';
      description = null;
      body = (
        <EmptyState
          liveRegion="off"
          title="No shop connection yet"
          message="Connect a WooCommerce store and enable the ProductPublisher capability to publish products from OpenLinker."
          action={
            <Link className="button button--secondary" to="/connections">
              Go to Integrations →
            </Link>
          }
        />
      );
    } else {
      title = 'Publish to shop';
      description = 'Choose the shop connection to publish onto.';
      body = (
        <>
          <FormField label="Connection" name="connection">
            <Select
              value={pickerDraft}
              onChange={(e) => setPickerDraft(e.target.value)}
              aria-label="Shop connection"
            >
              <option value="">Choose a connection…</option>
              {shopConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.platformType})
                </option>
              ))}
            </Select>
          </FormField>
          <div className="wizard-actions">
            <div className="wizard-actions__group">
              <Button tone="ghost" type="button" onClick={close}>
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
    title = 'Publish to shop';
    description = null;
    body = (
      <>
        <Alert tone="warning" title="No publish wizard for this platform">
          The selected connection&apos;s platform (
          <span className="mono-text">{pickedConnection.platformType}</span>) doesn&apos;t ship a
          publish wizard yet. Shop publishing is available for WooCommerce today.
        </Alert>
        <div className="wizard-actions">
          <div className="wizard-actions__group">
            <Button tone="ghost" type="button" onClick={close}>
              Close
            </Button>
          </div>
        </div>
      </>
    );
  } else {
    title = `Publish to ${pickedConnection.name}`;
    description = pickedConnection.platformType;
    const Wizard = wizardContribution.component;
    body = (
      <Wizard
        connection={pickedConnection}
        defaultVariantId={defaultVariantId}
        defaultVariantIds={defaultVariantIds}
        onCancel={close}
        onSubmitted={(result, connectionId) =>
          setSubmitted({ connectionId, recordId: result.recordId, batchId: result.batchId })
        }
      />
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="dialog__content--publish">
        <DialogTitle>{title}</DialogTitle>
        {description !== null ? (
          <DialogDescription className="mono-text">{description}</DialogDescription>
        ) : null}
        {body}
      </DialogContent>
    </Dialog>
  );
}
