/**
 * Pack bench (#2413, `W3b-1`, spec § 2.1)
 *
 * Surface A of the pack bench: who is signed in, the idle lock, the handover.
 *
 * ## Why this page exists now, with a placeholder body
 *
 * A2–A4 are properties of a MOUNTED surface — "switching user is reachable from
 * the packing surface", "locking never discards progress", "visible in the same
 * glance as the item being scanned". Shipping the identity machinery unmounted
 * would leave all three asserted only against themselves; mounting it on
 * `/fulfillment` would put an idle lock on an operator's own worklist, which is
 * a different surface for a different person.
 *
 * So the bench exists, with the identity behaviour real and the body a
 * placeholder. **#2416 fills the body with the work list and #2418 with the
 * parcel.** The placeholder is the honest minimum, not a stub for its own sake:
 * `BenchSurface` never unmounts its children, so whatever those issues put here
 * inherits "progress survives a lock and a handover" for free.
 *
 * ## No sidebar entry
 *
 * The bench is not an operator destination and has no nav registration here —
 * a packer reaches it by URL at a terminal. #2416 decides whether it earns a
 * nav entry once there is work to show, and a nav entry would additionally need
 * `RoleValues` widening (it is `['admin','operator']` today).
 *
 * ## This file carries no user-visible string literals
 *
 * Everything an operator reads comes from `features/bench/lib/bench-identity.copy.ts`,
 * which `scripts/check-ui-vocabulary.mjs` scans. The placeholder text below is
 * the one exception and is deliberately about the PRODUCT's state rather than
 * about a parcel — it names no order, no buyer and no work object.
 *
 * @module apps/web/src/pages/bench
 */
import type { ReactElement } from 'react';

import { BenchSurface } from '../../features/bench';

export function BenchPage(): ReactElement {
  return (
    <BenchSurface>
      <section className="bench-placeholder" data-testid="bench-placeholder">
        <h1>Pack bench</h1>
        <p>
          The work waiting at this bench is not built yet. Signing in, locking and handing the bench
          over all work now; the box itself arrives next.
        </p>
      </section>
    </BenchSurface>
  );
}
