/**
 * Bench Source Change (#3961, mockup `source-quantity-change.html` - bench)
 *
 * The bench's one hard signal while a box holds more units than the order now
 * asks for: how many to take out, of which item, and from which shelf. It
 * replaces the generic "On hold" alert for that case, because "put the tote
 * back" is the wrong instruction when one unit simply has to come out first.
 *
 * One card per line to take out; in practice there is almost always one.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import type { BenchParcelLine, BenchParcelSourceChange } from '../api/bench-parcel.types';
import { benchParcelCopy } from '../lib/bench-parcel.copy';

export interface BenchSourceChangeProps {
  readonly sourceChange: BenchParcelSourceChange;
  readonly lines: readonly BenchParcelLine[];
  /**
   * "Done, I took it out" for one line. Absent hides the button (a session that
   * may not write at the bench reads the card but cannot confirm it).
   */
  readonly onTakenOut?: (workLineId: string) => void;
  /** A confirmation is in flight; the button is disabled so it is not sent twice. */
  readonly pending?: boolean;
}

export function BenchSourceChange({
  sourceChange,
  lines,
  onTakenOut,
  pending = false,
}: BenchSourceChangeProps): ReactElement | null {
  const copy = benchParcelCopy.sourceChange;
  const entries = sourceChange.takeOut
    .map((entry) => ({ entry, line: lines.find((candidate) => candidate.workLineId === entry.workLineId) }))
    .filter(({ entry }) => entry.units > 0);
  if (entries.length === 0) return null;

  return (
    <div className="bench-source-change__stack">
      {entries.map(({ entry, line }) => (
        <section
          key={entry.workLineId}
          className="bench-source-change"
          role="alert"
          data-testid="bench-source-change"
        >
          <div className="bench-source-change__count">
            <span className="bench-source-change__count-label">{copy.countLabel}</span>
            <span className="bench-source-change__count-value">{entry.units}</span>
          </div>
          <div className="bench-source-change__body">
            <span className="bench-source-change__title">{line?.name ?? copy.unnamedItem}</span>
            <span>{copy.takeOutBody(entry.units, line?.binCode ?? null)}</span>
            <span className="bench-source-change__note">{copy.takeOutNote}</span>
          </div>
          {onTakenOut === undefined ? null : (
            <Button
              tone="primary"
              className="bench-source-change__action"
              disabled={pending}
              onClick={() => {
                onTakenOut(entry.workLineId);
              }}
            >
              {copy.takenOutAction}
            </Button>
          )}
        </section>
      ))}
    </div>
  );
}
