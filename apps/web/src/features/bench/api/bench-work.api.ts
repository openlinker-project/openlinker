/**
 * Pack-bench API client (#2416, `W3b-3`)
 *
 * Two calls: read the bench's work, and move one parcel to the front of the
 * queue or back into deadline order.
 *
 * ## The expedite goes through the SHARED fulfilment action route
 *
 * `POST /fulfillment/works/:workId/actions/:action` is the one guarded action
 * endpoint (#2406), and its `:action` is validated against the same constant
 * the read model filters `supportedActions` with. Minting a bench-specific
 * write would have been a second door onto the same aggregate carrying its own
 * copy of the optimistic-token handling — the #1487 choke-point rule, one level
 * out. It also means the bench cannot offer a control the server would reject.
 *
 * @module apps/web/src/features/bench/api
 */
import {
  parseBenchDocuments,
  parseBenchParcel,
  parseBenchReopenResult,
  parseBenchUnlabelledParcelList,
  parseBenchVerificationResult,
} from './bench-parcel.schema';
import type {
  BenchDocuments,
  BenchParcel,
  BenchReopenResult,
  BenchUnlabelledParcelList,
  BenchVerificationResult,
} from './bench-parcel.types';
import { parseBenchWorkList } from './bench-work.schema';
import type { BenchWorkList } from './bench-work.types';

export interface BenchApi {
  /**
   * Everything routed to this bench's packing connection and accepted there.
   *
   * Takes no arguments: the scope is a property of the bench rather than of the
   * request, and the server decides it. The search field filters rows the
   * browser already holds.
   */
  listWork: () => Promise<BenchWorkList>;
  /**
   * Move one parcel ahead of deadline order, or put it back.
   *
   * `action` is whichever of the pair the server offered in `supportedActions`
   * — the direction is never decided here. `expectedVersion` is the optimistic
   * token read with the row; a stale one answers 409.
   */
  setExpedited: (workId: string, action: string, expectedVersion: number) => Promise<void>;

  // ── #2418, Surfaces D/E/F ────────────────────────────────────────────────
  // Added to the SAME namespace rather than a second one: the bench reaches a
  // parcel THROUGH its work, and every route below is scoped by the server to
  // the work this bench may pack. A separate `benchParcels` client would say
  // otherwise, and would need its own copy of the same scoping story.

  /** What must go in this box, how far it has got, and whether it may be packed. */
  getParcel: (workId: string) => Promise<BenchParcel>;
  /**
   * Record one unit against one line — and shut the box when it was the last.
   *
   * The body names a LINE and a gesture, never a barcode: a scan and a
   * hand-confirm are the identical request, so the two cannot be told apart
   * downstream (D20). The scanned value is matched to a line in the browser and
   * never sent.
   */
  verifyUnit: (
    workId: string,
    input: { readonly workLineId: string; readonly gestureId: string }
  ) => Promise<BenchVerificationResult>;
  /** Reopen a box closed by mistake. `expectedVersion` is the token read with the parcel. */
  reopenParcel: (workId: string, expectedVersion?: number) => Promise<BenchReopenResult>;
  /** The invoice that goes inside the box and the label that goes on it. */
  getDocuments: (workId: string) => Promise<BenchDocuments>;
  /** The rendered invoice for this parcel's own order. Creates nothing. */
  downloadInvoice: (workId: string) => Promise<Blob>;
  /** Finished boxes with no label on them, here and in dispatch. */
  listUnlabelledParcels: () => Promise<BenchUnlabelledParcelList>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

interface ApiBlobRequest {
  (path: string, init?: RequestInit): Promise<Blob>;
}

export function createBenchApi(request: ApiRequest, requestBlob: ApiBlobRequest): BenchApi {
  const work = (workId: string): string => `/bench/work/${encodeURIComponent(workId)}`;

  return {
    async listWork(): Promise<BenchWorkList> {
      return parseBenchWorkList(await request<unknown>('/bench/work'));
    },
    async setExpedited(workId, action, expectedVersion): Promise<void> {
      await request<unknown>(
        `/fulfillment/works/${encodeURIComponent(workId)}/actions/${encodeURIComponent(action)}`,
        { method: 'POST', body: JSON.stringify({ expectedVersion }) }
      );
    },

    async getParcel(workId): Promise<BenchParcel> {
      return parseBenchParcel(await request<unknown>(`${work(workId)}/parcel`));
    },
    async verifyUnit(workId, input): Promise<BenchVerificationResult> {
      return parseBenchVerificationResult(
        await request<unknown>(`${work(workId)}/verifications`, {
          method: 'POST',
          // Exactly these two fields, whichever control the packer touched.
          body: JSON.stringify({ workLineId: input.workLineId, gestureId: input.gestureId }),
        })
      );
    },
    async reopenParcel(workId, expectedVersion): Promise<BenchReopenResult> {
      return parseBenchReopenResult(
        await request<unknown>(`${work(workId)}/reopen`, {
          method: 'POST',
          body: JSON.stringify({ expectedVersion }),
        })
      );
    },
    async getDocuments(workId): Promise<BenchDocuments> {
      return parseBenchDocuments(await request<unknown>(`${work(workId)}/documents`));
    },
    async downloadInvoice(workId): Promise<Blob> {
      return requestBlob(`${work(workId)}/documents/invoice`);
    },
    async listUnlabelledParcels(): Promise<BenchUnlabelledParcelList> {
      return parseBenchUnlabelledParcelList(await request<unknown>('/bench/unlabelled-parcels'));
    },
  };
}
