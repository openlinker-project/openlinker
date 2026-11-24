/**
 * Receipt Line-Name Budget Capability
 *
 * Optional sub-capability of {@link FiscalizationPort} (ADR-002 composition,
 * declared in the ADR-046 shape). A provider whose registering mechanism
 * compares only the first N characters of a line name declares that N here.
 *
 * It exists so core never holds the number. How many characters a registering
 * mechanism compares is a fact about a regime and its devices; core reads what
 * an adapter declares and folds the answers together with
 * `combineReceiptLineNameLimits` (`sales-documents`), which also supplies the
 * conservative fallback for a provider that declares nothing.
 *
 * The guard probes the METHOD rather than trusting the type, so an adapter
 * compiled against an older `libs/core` that lacks it simply declares nothing.
 *
 * @module libs/core/src/fiscalization/domain/ports/capabilities
 */
import type { FiscalizationPort } from '../fiscalization.port';

export interface ReceiptLineNameBudget {
  /**
   * Characters of a line name, rate suffix included, the registering mechanism
   * compares. A positive whole number; anything else is ignored by the reader.
   * Synchronous and side-effect free: it is read on a settings save.
   */
  getReceiptLineNameMaxLength(): number;
}

export function isReceiptLineNameBudget(
  adapter: FiscalizationPort,
): adapter is FiscalizationPort & ReceiptLineNameBudget {
  return (
    typeof (adapter as Partial<ReceiptLineNameBudget>).getReceiptLineNameMaxLength === 'function'
  );
}
