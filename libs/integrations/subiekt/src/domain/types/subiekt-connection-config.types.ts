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
}
