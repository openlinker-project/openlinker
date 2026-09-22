/**
 * Subiekt Connection Config Types (#753)
 *
 * Non-secret per-connection configuration for the Subiekt nexo invoicing
 * adapter. `bridgeBaseUrl` is the root URL of the LOCAL Windows bridge service
 * (#752) that wraps InsERT's Sfera SDK — NOT Subiekt itself. Named to make that
 * explicit. Decorator-free; the class-validator schema lives in the application
 * DTO (`application/dto/subiekt-connection-config.dto.ts`).
 *
 * @module libs/integrations/subiekt/src/domain/types
 */

/**
 * Payment-method vocabulary the Subiekt bridge accepts on `POST /api/invoices`
 * (`as const` + union pattern per engineering-standards.md).
 */
export const SubiektPaymentMethodValues = ['cash', 'transfer'] as const;
export type SubiektPaymentMethod = (typeof SubiektPaymentMethodValues)[number];

export interface SubiektConnectionConfig {
  /**
   * Root URL of the local Subiekt bridge (#752). Must include protocol
   * (`http://`/`https://`). Validated at save-time by the config-shape
   * validator and again at HTTP-client construction (defense-in-depth SSRF
   * guard — see `infrastructure/http/subiekt-url-safety.ts`).
   */
  bridgeBaseUrl: string;

  /** Optional per-request timeout in milliseconds. */
  timeoutMs?: number;

  /**
   * Default payment method threaded onto every issued invoice (#1324). When
   * UNSET the adapter sends nothing (true additive/no-regression path) — it
   * does NOT default to `'cash'`. `'transfer'` additionally requires a
   * `bankAccountId`; the bridge is the enforcement authority.
   */
  defaultPaymentMethod?: SubiektPaymentMethod;

  /**
   * Seller bank-account id used when `defaultPaymentMethod === 'transfer'`.
   * Bridge-native int from `GET /api/bank-accounts`, stored verbatim — NOT an
   * OL internal id, no snapshot, no identifier-mapping (see plan §4).
   */
  bankAccountId?: number;

  /**
   * Default Stanowisko Kasowe (cash-register station) id stamped on issued
   * invoices (#1324). Bridge-native int from `GET /api/cash-registers`, stored
   * verbatim — no snapshot, no identifier-mapping. The Oddział (branch) axis is
   * NOT configurable: the Sfera session binds it read-only to the logged-in
   * bridge session, so a per-request override can only ever be rejected.
   */
  defaultStanowiskoKasoweId?: number;

  /**
   * `uf_Konfiguracja.uko_Id` — the physical fiscal-printer this connection
   * registers documents on (Fiscalization capability, #3192). REQUIRED for
   * fiscalization to mean anything: `SuDokument.RejestrujNaUF` has no effect
   * without a target device (Pomoc/gta.chm `SuDokument_DrukarkaFiskalnaId.htm`,
   * confirmed live — an unconfigured/wrong id fails fast with a clear Sfera
   * error rather than hanging). Absent when the connection has `Fiscalization`
   * disabled; the factory only builds a `SubiektFiscalizationAdapter` when set.
   */
  drukarkaFiskalnaId?: number;
  /**
   * The Subiekt magazyn (`sl_Magazyn.mag_Id`) whose stock this connection
   * publishes — i.e. the warehouse a sale actually releases from.
   *
   * It exists because stock USED to be summed across every magazyn while the
   * release came out of one: a towar holding 506 in MAG and 2 in MAP was
   * advertised as 508, and those 2 units could never ship. That is a standing
   * oversell on any multi-warehouse install, with every counter internally
   * consistent and nothing logged.
   *
   * Absent, the adapter uses the bridge's own `domyslnyMagazynId` (the same
   * `ResolveDefaultMagazyn` its adjust path uses), which is right on the
   * ordinary single-warehouse install and is what the observed sale released
   * from. Set it when the operator's release warehouse is NOT that one — the
   * adapter warns whenever a towar has stock in more than one magazyn and no
   * explicit choice was made, because that is exactly when a default is a
   * guess rather than a fact.
   */
  stockMagazynId?: number;
}
