/**
 * Zero-line availability (#3941)
 *
 * Whether "Shown at 0.00" can be chosen, and the reason when it cannot. It is
 * offered only where a document provider declares it accepts a zero line; a
 * receipt always counts as no. The server degrades the choice to a technical
 * cent anyway where a provider refuses, so this is disclosure, not enforcement.
 *
 * @module apps/web/src/features/gift-documents/lib
 */
import type { DocumentProviderZeroSupport } from '../api/gift-documents.types';

export interface ZeroAvailability {
  available: boolean;
  /** The provider named in the reason, when exactly one refuses. */
  refusingProviderName: string | null;
}

export function zeroAvailability(
  providers: readonly DocumentProviderZeroSupport[] | undefined,
): ZeroAvailability {
  // Unknown providers (the read failed) leave the choice open rather than
  // withholding an option on a guess.
  if (providers === undefined) return { available: true, refusingProviderName: null };
  const accepts = providers.some((p) => p.kind === 'invoice' && p.acceptsZeroValueLine === true);
  if (accepts) return { available: true, refusingProviderName: null };
  const refusing = providers.filter((p) => p.acceptsZeroValueLine !== true);
  return {
    available: false,
    refusingProviderName: refusing.length === 1 ? refusing[0].name : null,
  };
}
