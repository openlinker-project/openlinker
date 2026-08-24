import { Button, EmptyState } from '@openlinker/web';

export const Default = () => (
  <EmptyState
    title="No connections yet"
    message="Connect a marketplace or shop to start syncing orders."
    action={
      <Button tone="primary" className="button--sm">
        Add connection
      </Button>
    }
  />
);

export const WithEyebrow = () => (
  <EmptyState
    eyebrow="Listings"
    title="No offers on this connection"
    message="Publish a product from the catalogue to create the first Allegro offer."
    action={
      <Button tone="primary" className="button--sm">
        Create offer
      </Button>
    }
  />
);

export const NoAction = () => (
  <EmptyState
    eyebrow="Filtered view"
    title="No orders match these filters"
    message="Nothing in the last 30 days is both unfulfilled and flagged as blocked. Clear a filter to widen the range."
  />
);
