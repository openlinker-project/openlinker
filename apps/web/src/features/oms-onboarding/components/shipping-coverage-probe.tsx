/**
 * Shipping coverage probes (#3958)
 *
 * The coverage of every order source is needed above the Shipping step: by
 * the stepper's tick, by the status page's Shipping row, and by part 2 of the
 * step itself. A hook cannot be called once per source in a loop, so each
 * source gets one invisible probe that reads its coverage and reports it up.
 * The reads are the routing editor's own cache entries, so the probes add no
 * requests the step would not make anyway.
 *
 * @module features/oms-onboarding/components
 */
import { useEffect, type ReactElement } from 'react';

import { useSourceShippingCoverage } from '../hooks/use-source-shipping-coverage';
import type { SourceShippingCoverage } from '../lib/shipping-coverage';

function ShippingCoverageProbe({
  sourceConnectionId,
  activeConnectionIds,
  onReport,
}: {
  readonly sourceConnectionId: string;
  readonly activeConnectionIds: ReadonlySet<string>;
  readonly onReport: (sourceConnectionId: string, coverage: SourceShippingCoverage) => void;
}): null {
  const coverage = useSourceShippingCoverage(sourceConnectionId, activeConnectionIds);
  const { status, withCarrier, total } = coverage;

  // Keyed on the primitives: the hook returns a fresh object every render, and
  // reporting on identity would loop through the parent's state update.
  useEffect(() => {
    onReport(sourceConnectionId, { status, withCarrier, total });
  }, [onReport, sourceConnectionId, status, withCarrier, total]);

  return null;
}

export function ShippingCoverageProbes({
  sourceConnectionIds,
  activeConnectionIds,
  onReport,
}: {
  readonly sourceConnectionIds: readonly string[];
  readonly activeConnectionIds: ReadonlySet<string>;
  readonly onReport: (sourceConnectionId: string, coverage: SourceShippingCoverage) => void;
}): ReactElement {
  return (
    <>
      {sourceConnectionIds.map((id) => (
        <ShippingCoverageProbe
          key={id}
          sourceConnectionId={id}
          activeConnectionIds={activeConnectionIds}
          onReport={onReport}
        />
      ))}
    </>
  );
}
