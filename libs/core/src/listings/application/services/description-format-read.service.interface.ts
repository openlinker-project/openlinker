/**
 * Description Format Read Service Interface
 *
 * Reads a connection's declared `DescriptionFormat` (ADR-046) so the frontend
 * can compose its editor from the destination's own contract instead of a table
 * it maintains itself. Destination-kind-agnostic: the caller supplies a
 * connection id and the service probes which capability declares the format.
 *
 * @module libs/core/src/listings/application/services
 */
import type {
  DescriptionFormat,
  DescriptionFormatSource,
} from '../../domain/types/description-format.types';

export interface DescriptionFormatView {
  /** The format to author against. Never null - see `declared`. */
  format: DescriptionFormat;
  /**
   * `false` when the destination declared nothing and `format` is the
   * conservative fallback. The UI surfaces this rather than pretending the
   * subset is authoritative (ADR-046 subordinate decision 1).
   */
  declared: boolean;
  /** Which capability answered, for diagnostics. */
  resolvedVia: DescriptionFormatSource | null;
}

export interface IDescriptionFormatReadService {
  getForConnection(connectionId: string): Promise<DescriptionFormatView>;
}
