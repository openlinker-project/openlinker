/**
 * Notes from the office (D12, scenario G03-6)
 *
 * Internal order notes an office user flagged "Show to packer", shown read
 * only above the item being packed. Absent when there are none, so an
 * ordinary parcel carries no empty block. Newest first, each with its author
 * and a calendar-relative time whose absolute form is on the `<time>` itself.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import type { BenchPackerNote } from '../api/bench-parcel.types';
import { describeBenchNoteTime, orderBenchOfficeNotes } from '../lib/bench-office-notes';
import { benchParcelCopy } from '../lib/bench-parcel.copy';

export interface BenchOfficeNotesProps {
  readonly notes: readonly BenchPackerNote[];
}

export function BenchOfficeNotes({ notes }: BenchOfficeNotesProps): ReactElement | null {
  if (notes.length === 0) return null;

  return (
    <Alert
      tone="info"
      title={benchParcelCopy.officeNotes.title(notes.length)}
      className="bench-office-note"
      data-testid="bench-office-notes"
    >
      <ul className="bench-office-note__list">
        {orderBenchOfficeNotes(notes).map((note) => {
          const time = describeBenchNoteTime(note.createdAt);
          return (
            <li key={note.id} className="bench-office-note__item" data-testid="bench-office-note">
              <span className="bench-office-note__body">{note.body}</span>
              <span className="bench-office-note__meta">
                {note.authorUsername} ·{' '}
                <time dateTime={note.createdAt} title={time.full}>
                  {time.label}
                </time>
              </span>
            </li>
          );
        })}
      </ul>
    </Alert>
  );
}
