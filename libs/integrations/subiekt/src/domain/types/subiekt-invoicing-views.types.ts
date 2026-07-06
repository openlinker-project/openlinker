/**
 * Subiekt Invoicing — adapter view types (#1324)
 *
 * Subiekt-LOCAL return shapes for the discovery methods that have no neutral
 * `libs/core` equivalent (decision 2/6 of the #1324 plan): the owner-aware
 * bank-account view (carries the multi-Podmiot owner tag the neutral
 * `InvoicingBankAccount` deliberately drops) and the Stanowisko Kasowe view (no
 * cross-plugin abstraction — inFakt/KSeF have no cash-register concept, so it
 * stays Subiekt-only). Ids are surfaced as the bridge-native NUMBERs the FE
 * uses directly (e.g. `SubiektCashRegisterView.id`/`.oddzialId`), NOT
 * stringified — these views feed the Subiekt-specific controller (#1324 Unit
 * E), not the neutral core surface.
 *
 * @module libs/integrations/subiekt/src/domain/types
 */

/**
 * Owner-aware bank-account view — the full bridge shape incl. the owning
 * seller Podmiot (`ownerPodmiotId`/`ownerName`) that the neutral
 * `InvoicingBankAccount` mapping drops. Feeds the Subiekt controller so the FE
 * can group accounts by payer and show the >1-owner payer-routing warning.
 */
export interface SubiektBankAccountView {
  id: string;
  accountNumber: string;
  bankName: string;
  isDefault: boolean;
  ownerPodmiotId: number;
  ownerName: string | null;
}

/**
 * One Stanowisko Kasowe (cash register), mapped 1:1 from the bridge.
 * `oddzialId: null` means the register is unlinked; a non-null value is the
 * register's own informational branch tag (a display label), NOT a per-request
 * routing override — the branch is bound read-only to the bridge session.
 */
export interface SubiektCashRegisterView {
  id: number;
  name: string | null;
  symbol: string | null;
  oddzialId: number | null;
}
