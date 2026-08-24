import { ConfirmDialog } from '@openlinker/web';

const noop = () => {};

export const DisableConnection = () => (
  <ConfirmDialog
    open
    tone="danger"
    title="Disable connection?"
    description={
      <>
        This stops order ingestion from <span className="mono">Allegro · Main store</span>.
        Existing jobs finish. 412 mapped offers stay published.
      </>
    }
    confirmLabel="Disable connection"
    cancelLabel="Keep active"
    onConfirm={noop}
    onOpenChange={noop}
  />
);

export const PublishBatch = () => (
  <ConfirmDialog
    open
    title="Publish 38 offers to Erli?"
    description={
      <>
        6 variants are already listed there and will be skipped, not duplicated. The remaining
        32 are enqueued as <span className="mono">marketplace.offer.create</span> jobs.
      </>
    }
    confirmLabel="Publish remaining variants"
    onConfirm={noop}
    onOpenChange={noop}
  />
);

export const Confirming = () => (
  <ConfirmDialog
    open
    tone="danger"
    isConfirming
    title="Cancel order OL-40218?"
    description="Restoring stock on 3 marketplaces and notifying the buyer. This cannot be undone."
    confirmLabel="Cancelling…"
    onConfirm={noop}
    onOpenChange={noop}
  />
);
