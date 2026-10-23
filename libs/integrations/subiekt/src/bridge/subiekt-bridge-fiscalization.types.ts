/**
 * Subiekt Bridge — Fiscalization wire types (#3192-fiscalization)
 *
 * Request/response shapes for the Windows bridge's fiscal-receipt endpoint,
 * `POST /api/fiscalize`. Bridge-native (Subiekt/PL dialect: `kasaFiskalnaId`,
 * `drukarkaFiskalnaId`, `stanowiskoKasoweId`) — the neutral <-> bridge mapping
 * lives in `SubiektFiscalizationAdapter`, NOT here. Mirrors the shape and
 * conventions of `subiekt-bridge.types.ts` (the invoicing contract).
 *
 * MECHANISM (per Pomoc/gta.chm, `SuDokument_RejestrujNaUF.htm` /
 * `SuDokument_DrukarkaFiskalnaId.htm` / `SuDokument_StatusFiskalny.htm` /
 * `SuDokumentyManager_DodajPAf.htm`, and the VBA example on the
 * `DrukarkaFiskalnaId` page):
 *
 *   oDok = SuDokumentyManager.DodajPAf()   ' paragon fiskalny, GT >= 1.12
 *   oDok.RejestrujNaUF = True              ' "register on Fiscal Device", GT >= 1.23
 *   oDok.DrukarkaFiskalnaId = <id>         ' -> uf_Konfiguracja.uko_Id
 *   oDok.Zapisz()
 *   oDok.Drukuj(True)                      ' drives the physical fiscal printer
 *   ' StatusFiskalny now reflects the outcome.
 *
 * UNVERIFIED LIVE: this session had no access to a physical fiscal printer nor
 * to the `uf_Konfiguracja` table's contents (worktree isolation blocked the
 * Windows bridge entirely — see the PR/commit message). The bridge-side
 * implementation of `/api/fiscalize` is written to this contract but has NOT
 * been run against a real device. `dok_StatusFiskalny`'s numeric enum values
 * are likewise unconfirmed; the bridge maps them defensively (unknown ->
 * `'unknown'`, never asserted as success) — see `FiscalizationEndpoints.cs`
 * (delivered as a ready-to-paste file, not yet copied onto the Windows host).
 *
 * @module libs/integrations/subiekt/bridge
 */

/**
 * Bridge-reported fiscal-registration outcome (`data.status`). Deliberately
 * NOT the neutral `FiscalRegistrationStatus` — this is what the BRIDGE
 * observed on `SuDokument.StatusFiskalny` immediately after `Drukuj(True)`,
 * translated by the adapter into ADR-042's `RegisterTransactionResult` /
 * thrown-exception vocabulary.
 *
 *   - `'registered'` — the bridge read a StatusFiskalny value it recognises as
 *     a confirmed, successful fiscal registration.
 *   - `'rejected'`   — Subiekt / the fiscal printer refused the document
 *     outright (a synchronous error surfaced before or during `Drukuj`).
 *     The document was NOT created — safe to re-attempt under the same key.
 *   - `'unknown'`    — the call completed with no thrown error, but the
 *     resulting `StatusFiskalny` value is not one the bridge's (unverified)
 *     mapping recognises as success. Fiscal-safe: the adapter treats this as
 *     `in-doubt`, never as a success.
 */
export const BridgeFiscalStatusValues = ['registered', 'rejected', 'unknown'] as const;
export type BridgeFiscalStatus = (typeof BridgeFiscalStatusValues)[number];

/** One line of the sale being fiscalized. Mirrors `BridgeInvoiceLine`'s shape. */
export interface BridgeFiscalLine {
  /** Optional catalogue symbol (`tw__Towar.tw_Symbol`); absent -> a one-time "usługa jednorazowa" line, same as the invoicing path. */
  towarSymbol?: string;
  /** Required when `towarSymbol` is absent — the line's display name. */
  nazwa?: string;
  ilosc: number;
  /** Gross unit price (Subiekt is configured gross-priced, `LiczonyOdCenBrutto`, mirroring the invoicing adapter). */
  cenaBrutto: number;
  /** Percent-rate code, e.g. `"23"`. Resolved to `sl_StawkaVAT.vat_Id` bridge-side, same as invoicing. */
  stawkaVAT: string;
}

export interface BridgeFiscalizeRequest {
  idempotencyKey: string;
  orderId: string;
  currency: string;
  lines: BridgeFiscalLine[];
  /** `dks_Kasa.ks_Id` — Stanowisko Kasowe. Optional; connection-level default applies when unset (mirrors `SubiektConnectionConfig.defaultStanowiskoKasoweId`). */
  stanowiskoKasoweId?: number;
  /** `uf_Konfiguracja.uko_Id` — the physical fiscal-printer id. REQUIRED: `RejestrujNaUF` has no meaning without a target device. */
  drukarkaFiskalnaId: number;
}

export interface BridgeFiscalizeResponse {
  /** Subiekt's internal numeric document id (`dok__Dokument.dok_Id`), stringified on the wire like the invoicing contract. */
  documentId: number;
  documentNumber: string;
  status: BridgeFiscalStatus;
  /** Raw `dok_StatusFiskalny` value, for operator/log diagnosis while the enum is unverified. */
  rawStatusFiskalny: number | null;
}
