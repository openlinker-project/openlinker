/**
 * Subiekt Bridge — InventoryMaster wire types (bridge-native, not yet reconciled)
 *
 * Request/response shapes for the bridge's `/api/inventory*` surface — the
 * Windows .NET service that wraps InsERT's Sfera GT SDK. **Bridge-native**
 * (Polish field names): the neutral <-> bridge mapping lives in
 * `SubiektInventoryMasterAdapter`, not here — mirrors the existing
 * `subiekt-bridge.types.ts` convention for Invoicing.
 *
 * IMPORTANT: these shapes are DESIGNED against Sfera GT facades confirmed live
 * during this session's research (`tw_Stan` SQL schema, `SuDokumentyManager
 * .DodajPW`/`.DodajRW`) but the bridge-side C# endpoint implementing them was
 * NOT built in this slice — the worktree sandbox this adapter was written in
 * has no access to the Windows bridge machine (`powershell.exe` is blocked).
 * The bridge author reconciling `InventoryEndpoints.cs` against this contract
 * MUST live-wire-test it exactly as `subiekt-bridge.types.ts`'s own header
 * records happened for Invoicing (#753/#754) — do not assume this is the final
 * wire shape until that reconciliation has run.
 *
 * The bridge wraps every response in `{ success, data, error }` — see the
 * shared `BridgeResponseEnvelope<T>` in `subiekt-bridge.types.ts`, reused here.
 *
 * @module libs/integrations/subiekt/bridge
 */

/**
 * `GET /api/inventory/{towarSymbol}/stock` response `data`.
 *
 * One row per Subiekt magazyn (warehouse) the towar has a `tw_Stan` position
 * in — mirrors `tw_Stan(st_TowId, st_MagId, st_Stan, st_StanRez)` verbatim.
 * `magazynId` is the Subiekt-native warehouse id (`sl_Magazyn.mag_Id`); the
 * adapter maps it to the neutral `Inventory.locationId` as a string.
 */
export interface BridgeInventoryStockRow {
  magazynId: number;
  magazynSymbol: string | null;
  /** `tw_Stan.st_Stan` — current quantity. */
  stan: number;
  /** `tw_Stan.st_StanRez` — reserved quantity (Subiekt's own reservation bookkeeping, distinct from OL's ledger). */
  stanRez: number;
}

export interface BridgeInventoryStockResponse {
  towarSymbol: string;
  /** Empty when the towar has no `tw_Stan` rows at all (never sold/stocked yet) — NOT a not-found. */
  positions: BridgeInventoryStockRow[];
}

/**
 * `POST /api/inventory/adjust` request body.
 *
 * `delta` is signed (positive = `SuDokumentyManager.DodajPW`, negative =
 * `DodajRW`) — mirrors `InventoryAdjustment.quantity` verbatim, so the adapter
 * does no sign translation.
 */
export interface BridgeInventoryAdjustRequest {
  towarSymbol: string;
  /** Optional — Subiekt's default magazyn is used when absent. */
  magazynId?: number;
  delta: number;
  /** Free-text note stamped on the PW/RW document's `Uwagi` (mirrors ZK's `req.Uwagi`). */
  uwagi?: string;
  /**
   * Caller's idempotency key (#2368). When present, the bridge checks
   * `dok_NrPelnyOryg` for a prior PW/RW carrying this key (mirroring
   * `Invoicing.FindByIdempotencyKey`'s `Trim30` pattern) before writing a new
   * document — a repeat returns the EXISTING document's post-adjustment stock
   * rather than adjusting twice.
   */
  idempotencyKey?: string;
}

export interface BridgeInventoryAdjustResponse {
  /** `true` when the bridge recognised `idempotencyKey` and applied nothing. */
  deduplicated: boolean;
  /** Subiekt document id of the PW/RW that applied the delta (or the ORIGINAL one, on a dedupe hit). */
  documentId: number;
  documentNumber: string;
  /** Post-adjustment `tw_Stan.st_Stan` for the affected magazyn. */
  stanAfter: number;
}

export {};
