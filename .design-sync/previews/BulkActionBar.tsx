import { BulkActionBar, Button } from '@openlinker/web';

/**
 * The bar renders `.bulk-action-bar--hidden` (opacity 0 / aria-hidden) whenever
 * `count === 0`, which is why a propless preview looked blank — the zero state
 * is intentionally invisible and is therefore not worth a cell of its own.
 * Every cell below carries a real selection, ported from the orders and
 * products list pages.
 */

export const OrdersSelection = () => (
  <BulkActionBar
    count={38}
    itemNoun="order"
    hint="Max 100 per source"
    actions={
      <>
        <Button tone="ghost">Clear</Button>
        <Button tone="primary">Dispatch 38</Button>
      </>
    }
  />
);

export const SingularCount = () => (
  <BulkActionBar
    count={1}
    itemNoun="order"
    hint="Max 100 per source"
    actions={
      <>
        <Button tone="ghost">Clear</Button>
        <Button tone="primary">Dispatch 1</Button>
      </>
    }
  />
);

export const MultiSourceHint = () => (
  <BulkActionBar
    count={1284}
    itemNoun="product"
    hint="3 sources · max 100 per source"
    actions={
      <>
        <Button tone="ghost">Clear</Button>
        <Button tone="secondary">Export CSV</Button>
        <Button tone="primary">Publish 1,284</Button>
      </>
    }
  />
);

export const DangerAction = () => (
  <BulkActionBar
    count={9}
    itemNoun="job"
    hint="Dead-lettered · Allegro · Main"
    actions={
      <>
        <Button tone="ghost">Clear</Button>
        <Button tone="danger">Discard 9</Button>
      </>
    }
  />
);
