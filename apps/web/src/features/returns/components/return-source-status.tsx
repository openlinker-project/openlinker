/**
 * Return Source Status
 *
 * The source channel's own status word, rendered verbatim and attributed.
 *
 * Three things this component deliberately does NOT do (returns spec §3.3):
 * it does not map the value onto an OpenLinker vocabulary, it does not pick a
 * traffic-light tone from it, and it is not sortable. The value is evidence
 * about what the channel said, not a state OpenLinker stands behind — so it
 * renders in a neutral chip carrying the channel's words and an attribution the
 * operator can read on hover.
 *
 * `null` is a real and different fact — the channel reported no status — and
 * renders as "Not reported" in muted text rather than as a status of its own.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { RETURNS_SOURCE_STATUS_COPY } from '../lib/returns-list.copy';

interface ReturnSourceStatusProps {
  rawStatus: string | null;
  /**
   * The channel's own display name, when the caller has resolved it (#2336).
   *
   * Optional, and the fallback is the generic `Source` prefix the list has
   * always rendered — a list row resolves its connection from a batched read
   * that may not have arrived, and a prefix that flickers between two words is
   * worse than one that never changes. Where the name IS known the attribution
   * reads as the returns spec §3.3 writes it (`Allegro: COMMISSION_REFUND_CLAIMED`),
   * which is the point: the operator must be able to see WHOSE word this is.
   */
  sourceName?: string | null;
}

export function ReturnSourceStatus({
  rawStatus,
  sourceName = null,
}: ReturnSourceStatusProps): ReactElement {
  if (rawStatus === null || rawStatus === '') {
    return (
      <span className="text-muted" title={RETURNS_SOURCE_STATUS_COPY.notReportedHint}>
        {RETURNS_SOURCE_STATUS_COPY.notReported}
      </span>
    );
  }

  const prefix =
    sourceName !== null && sourceName !== '' ? sourceName : RETURNS_SOURCE_STATUS_COPY.prefix;

  return (
    <span className="mono-text" title={RETURNS_SOURCE_STATUS_COPY.attribution}>
      {prefix}: {rawStatus}
    </span>
  );
}
