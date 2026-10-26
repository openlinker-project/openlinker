/**
 * Notes from the office (D12, scenario G03-6)
 *
 * The clock is pinned (only `Date` is faked, so RTL's own timers are left
 * alone) and every fixture time is built in LOCAL time, so "today" and
 * "yesterday" mean the same thing in whatever zone the suite runs in.
 *
 * @module apps/web/src/features/bench/components
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatAbsoluteTime, formatDateTime } from '../../../shared/format/format-date';
import type { BenchPackerNote } from '../api/bench-parcel.types';
import { BenchOfficeNotes } from './bench-office-notes';

const NOW = new Date(2026, 8, 30, 15, 0);
const TODAY = new Date(2026, 8, 30, 12, 40).toISOString();
const YESTERDAY = new Date(2026, 8, 29, 11, 31).toISOString();
const LAST_WEEK = new Date(2026, 8, 23, 9, 5).toISOString();

function note(over: Partial<BenchPackerNote> & Pick<BenchPackerNote, 'id'>): BenchPackerNote {
  return {
    body: 'Put the paper invoice under the flap.',
    authorUsername: 'marta.nowak',
    createdAt: TODAY,
    ...over,
  };
}

describe('BenchOfficeNotes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render each flagged note with its author when notes are present', () => {
    render(
      <BenchOfficeNotes
        notes={[
          note({ id: 'n1', body: 'Put the paper invoice under the flap.' }),
          note({
            id: 'n2',
            body: 'Check both mugs for chipped glaze.',
            authorUsername: 'jan.kowalski',
            createdAt: YESTERDAY,
          }),
        ]}
      />
    );

    expect(screen.getByText('Notes from the office (2)')).toBeInTheDocument();
    expect(screen.getByText('Put the paper invoice under the flap.')).toBeInTheDocument();
    expect(screen.getByText('Check both mugs for chipped glaze.')).toBeInTheDocument();
    expect(screen.getByText(/marta\.nowak/)).toBeInTheDocument();
    expect(screen.getByText(/jan\.kowalski/)).toBeInTheDocument();
  });

  it('should read today and yesterday in calendar words when the note is that recent', () => {
    render(
      <BenchOfficeNotes
        notes={[note({ id: 'n1', createdAt: YESTERDAY }), note({ id: 'n2', createdAt: TODAY })]}
      />
    );

    expect(screen.getByText(`today ${formatAbsoluteTime(TODAY)}`)).toBeInTheDocument();
    expect(screen.getByText(`yesterday ${formatAbsoluteTime(YESTERDAY)}`)).toBeInTheDocument();
  });

  it('should show the absolute date when the note is older than yesterday', () => {
    render(<BenchOfficeNotes notes={[note({ id: 'n1', createdAt: LAST_WEEK })]} />);

    const time = screen.getByText(formatDateTime(LAST_WEEK));
    expect(time.tagName).toBe('TIME');
    expect(time.textContent).not.toMatch(/today|yesterday/);
  });

  it('should carry the machine timestamp and the full absolute time on every <time>', () => {
    render(
      <BenchOfficeNotes
        notes={[note({ id: 'n1', createdAt: TODAY }), note({ id: 'n2', createdAt: LAST_WEEK })]}
      />
    );

    const times = screen
      .getAllByTestId('bench-office-note')
      .map((item) => item.querySelector('time'));
    expect(times.map((time) => time?.getAttribute('dateTime'))).toEqual([TODAY, LAST_WEEK]);
    expect(times.map((time) => time?.getAttribute('title'))).toEqual([
      formatDateTime(TODAY),
      formatDateTime(LAST_WEEK),
    ]);
  });

  it('should list the newest note first when the API sends them in creation order', () => {
    render(
      <BenchOfficeNotes
        notes={[
          note({ id: 'old', body: 'Oldest instruction', createdAt: LAST_WEEK }),
          note({ id: 'mid', body: 'Middle instruction', createdAt: YESTERDAY }),
          note({ id: 'new', body: 'Newest instruction', createdAt: TODAY }),
        ]}
      />
    );

    const bodies = screen
      .getAllByTestId('bench-office-note')
      .map((item) => within(item).getByText(/instruction/).textContent);
    expect(bodies).toEqual(['Newest instruction', 'Middle instruction', 'Oldest instruction']);
  });

  it('should render nothing when there are no notes', () => {
    const { container } = render(<BenchOfficeNotes notes={[]} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('bench-office-notes')).not.toBeInTheDocument();
    expect(screen.queryByText(/Notes from the office/)).not.toBeInTheDocument();
  });
});
