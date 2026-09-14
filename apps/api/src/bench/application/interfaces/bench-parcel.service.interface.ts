/**
 * Bench parcel service contract (#2418, `W3b-5`, spec §§ 2.4–2.5)
 *
 * ## There is no `closeParcel`, and there never will be
 *
 * Decision D18: *"the parcel closes on the last verification, with no
 * confirmation step."* The close is a consequence of `verifyUnit` inside the
 * core service's own transaction, so this interface has nothing for a commit
 * control to call — a "Done" button on the bench is not discouraged, it has no
 * method. `no-parcel-commit-control.spec.ts` asserts that neither this
 * interface nor the controller behind it ever grows one.
 *
 * @module apps/api/src/bench/application/interfaces
 */
import type { FulfillmentWorkView } from '@openlinker/core/fulfillment';

import type {
  BenchParcelView,
  BenchReopenResultView,
  BenchVerificationResultView,
} from '../types/bench-parcel.types';

export const BENCH_PARCEL_SERVICE_TOKEN = Symbol('IBenchParcelService');

/** One unit into the box. The SAME shape for a scan and for a hand-confirm (D20). */
export interface BenchVerifyUnitInput {
  readonly workId: string;
  readonly workLineId: string;
  /** #2416's durable per-gesture id, minted client-side by BOTH paths. */
  readonly gestureId: string;
  /**
   * NON-NULLABLE, and that is the route half of #2890 F1.
   *
   * A verification can CLOSE the parcel (D18), and the close writes this value
   * into `fulfillment_works.packedByUserId`. Core's own `VerifyUnitInput` still
   * accepts `string | null`, because the per-unit verification ledger admits a
   * non-bench verifier — but the bench is not that caller, and while this field
   * was nullable the controller could source it from an optional
   * `@CurrentUser()` and produce a closed parcel naming nobody. Narrowing it
   * here makes that unrepresentable in the TYPE, one layer above the CHECK, so
   * the constraint stays a backstop rather than the thing turning a reachable
   * route into a 500.
   */
  readonly verifiedByUserId: string;
}

export interface BenchReopenInput {
  readonly workId: string;
  readonly reopenedByUserId: string | null;
  readonly expectedVersion?: number;
}

export interface IBenchParcelService {
  /**
   * Open the parcel — what must go in the box, and whether it may be packed.
   *
   * Raises `FulfillmentWorkNotFoundError` for an unknown work and
   * `BenchParcelNotAtThisBenchError` for one belonging to another executor;
   * both answer 404, because "not yours" and "does not exist" must look the
   * same from outside a scoped read.
   */
  getParcel(workId: string): Promise<BenchParcelView>;

  /**
   * The work behind a parcel, scoped exactly as `getParcel` scopes it.
   *
   * Exists so the documents surface asks "may this session see this parcel"
   * through the SAME rule the box itself is opened by — story D2 applied to the
   * paperwork. It answers with the fulfilment read model rather than the bench
   * projection because the documents service needs `orderId`, which the parcel
   * view deliberately does not carry (a packer has no use for an internal order
   * id, and every field on that view is a disclosure decision).
   *
   * Raises the same two errors, which the controller answers 404.
   */
  getWorkForDocuments(workId: string): Promise<FulfillmentWorkView>;

  /** Verify one unit in (E1/E3/E4) — and shut the box when it was the last (E5). */
  verifyUnit(input: BenchVerifyUnitInput): Promise<BenchVerificationResultView>;

  /** Open a box shut by mistake (E6). Refused once the goods have gone (D19). */
  reopenParcel(input: BenchReopenInput): Promise<BenchReopenResultView>;
}
