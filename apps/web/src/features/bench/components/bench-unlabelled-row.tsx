/**
 * One finished box with no label on it, on the bench's own rail (#3416,
 * mockup-parity epic #3401)
 *
 * The SAME read dispatch consumes (`useBenchUnlabelledQuery`, #2418 story
 * F1's docblock) — never a second source, or this row and dispatch's own
 * label queue could disagree about a box on a floor. Clickable: opening it
 * lets a packer view or reprint the label from `BenchDocumentsPanel`, which
 * `BenchParcelView` already renders for a closed parcel.
 *
 * A lighter row than `BenchWorkRow` (`.bench-rail-row`, not
 * `.bench-work-row`'s four-column grid) — there is no deadline countdown and
 * no expedite control on a box that has already been packed, so the fuller
 * grid's empty columns would just be dead space here.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { StatusBadge } from '../../../shared/ui/status-badge';
import type { BenchUnlabelledParcel } from '../api/bench-parcel.types';
import { benchWorkCopy } from '../lib/bench-work.copy';

export interface BenchUnlabelledRowProps {
  readonly parcel: BenchUnlabelledParcel;
  readonly onOpenParcel?: (workId: string) => void;
}

export function BenchUnlabelledRow({
  parcel,
  onOpenParcel,
}: BenchUnlabelledRowProps): ReactElement {
  const body = (
    <>
      <div className="bench-rail-row__identity">
        <span className="bench-rail-row__reference">{parcel.orderReference}</span>
        <span className="bench-rail-row__meta">
          {benchWorkCopy.tabs.nothingLeftHere}
          {parcel.carrier === null ? null : <> · {parcel.carrier}</>}
        </span>
      </div>
      <StatusBadge tone="error" withDot compact>
        {benchWorkCopy.tabs.unlabelledBadge}
      </StatusBadge>
    </>
  );

  if (onOpenParcel === undefined) {
    return (
      <li className="bench-rail-row" data-testid="bench-unlabelled-row">
        {body}
      </li>
    );
  }

  return (
    <li className="bench-rail-row" data-testid="bench-unlabelled-row">
      <button
        type="button"
        className="bench-rail-row__open"
        onClick={() => {
          onOpenParcel(parcel.workId);
        }}
      >
        {body}
      </button>
    </li>
  );
}
