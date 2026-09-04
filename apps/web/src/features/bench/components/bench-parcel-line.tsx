/**
 * One line of one box (#2418, `W3b-5`, stories E1/E3/E4, D20)
 *
 * ## A hand-confirmed line is INDISTINGUISHABLE from a scanned one (D20)
 *
 * Not by convention — this component has **no input that could tell them
 * apart**. Its props are the line, whether it is the one being scanned, and the
 * confirm callback; nothing carries how a unit arrived, because nothing upstream
 * carries it either. `VerifyUnitDto` names a LINE and a gesture, so the parcel
 * read that feeds this component has no provenance field to render, and there is
 * no branch here that could grow one without also inventing the data.
 *
 * That matters more than it looks. D20's reasoning is that marking a manual
 * confirmation creates a stigma, and stigma drives the workaround the system
 * cannot detect: the packer scans a second unit of the same code twice, and the
 * box closes looking perfectly verified. A badge saying "confirmed by hand" is
 * the cheapest possible change to this file and the most expensive one to the
 * warehouse, so the absence is asserted by
 * `bench-parcel.test.tsx` comparing the rendered markup of the two paths
 * byte for byte.
 *
 * ## State is written in WORDS, never in colour alone
 *
 * The count, the remaining-units phrase and the badge are all text, following
 * `BenchWorkRow`'s rule. The tint is an addition to that.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { BenchParcelLine } from '../api/bench-parcel.types';
import { benchLineState, type BenchLineState } from '../lib/bench-parcel-presentation';
import { benchParcelCopy } from '../lib/bench-parcel.copy';

export interface BenchParcelLineRowProps {
  readonly line: BenchParcelLine;
  /** Whether the box is still open. A closed box offers no confirm control. */
  readonly open: boolean;
  /** E4's path. Sends exactly what a scan sends. */
  readonly onConfirm: (line: BenchParcelLine) => void;
  readonly busy?: boolean;
}

const BADGE_TONE: Readonly<Record<BenchLineState, StatusBadgeTone>> = {
  verified: 'success',
  'in-progress': 'info',
  'not-started': 'neutral',
};

const BADGE_TEXT: Readonly<Record<BenchLineState, string>> = {
  verified: benchParcelCopy.lines.badgeVerified,
  'in-progress': benchParcelCopy.lines.badgeScanning,
  'not-started': benchParcelCopy.lines.badgeNotScanned,
};

export function BenchParcelLineRow({
  line,
  open,
  onConfirm,
  busy = false,
}: BenchParcelLineRowProps): ReactElement {
  const state = benchLineState(line);
  const remaining = Math.max(0, line.requiredQuantity - line.verifiedQuantity);
  const codes = benchParcelCopy.lines.codes({ ean: line.ean, sku: line.sku });

  return (
    <li
      className={`bench-parcel-line bench-parcel-line--${state}`}
      data-testid="bench-parcel-line"
      data-line-id={line.workLineId}
    >
      <div className="bench-parcel-line__identity">
        <span className="bench-parcel-line__name">
          {line.name ?? benchParcelCopy.lines.unnamed}
        </span>
        {codes.length === 0 ? null : (
          <span className="bench-parcel-line__codes">{codes}</span>
        )}
      </div>

      <div className="bench-parcel-line__count">
        <span className="bench-parcel-line__count-value">
          {benchParcelCopy.lines.count(line.verifiedQuantity, line.requiredQuantity)}
        </span>
        <span className="bench-parcel-line__count-note">
          {state === 'verified'
            ? benchParcelCopy.lines.allIn
            : state === 'not-started'
              ? benchParcelCopy.lines.noneYet
              : benchParcelCopy.lines.stillToScan(remaining)}
        </span>
      </div>

      <div className="bench-parcel-line__state">
        <StatusBadge tone={BADGE_TONE[state]} withDot={state !== 'not-started'}>
          {BADGE_TEXT[state]}
        </StatusBadge>
      </div>

      <div className="bench-parcel-line__actions">
        {/* E4. Offered only while the box is open and the line has room — a
            control that could only be refused is worse than none on a surface
            worked at speed. */}
        {open && state !== 'verified' ? (
          <Button
            tone="secondary"
            disabled={busy}
            onClick={() => {
              onConfirm(line);
            }}
          >
            {benchParcelCopy.lines.confirmAction}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
