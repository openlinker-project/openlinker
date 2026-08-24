/**
 * Analytics Date Range Toolbar
 *
 * Presets (7d/30d/90d/Custom) + From/To date fields + a draft-buffered
 * Apply action. Presets commit immediately; a typed range stays a local
 * draft until Apply is clicked — see Decision 1 in
 * docs/plans/implementation-plan-analytics-page-shell.md.
 *
 * @module apps/web/src/features/analytics/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, Popover, PopoverContent, PopoverTrigger, SegmentedControl } from '../../../shared/ui';
import {
  computePresetRange,
  derivePreset,
  type DateRangeHighlight,
  type DateRangePreset,
} from '../lib/date-range.lib';

interface AnalyticsDateRangeToolbarProps {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
}

const PRESET_OPTIONS: readonly { value: DateRangeHighlight; label: string }[] = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'custom', label: 'Custom' },
];

// Operator-facing: no schema jargon (no "placedAt", no "column"). The
// underlying reason is that `placedAt` isn't yet a filterable read-model
// column — tracked for #1990 — but that's a developer fact, not one an
// operator can act on, so it stays out of the rendered copy/aria-label.
const ORDER_DATE_CAVEAT = "This range doesn't filter results yet — coming soon";

export function AnalyticsDateRangeToolbar({
  from,
  to,
  onApply,
}: AnalyticsDateRangeToolbarProps): ReactElement {
  const today = useRef(new Date()).current;
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [forcedCustom, setForcedCustom] = useState(false);
  const fromInputRef = useRef<HTMLInputElement>(null);

  // Reload / commit both land here: the draft resets to whatever is now
  // the committed range, and the forced-custom override clears so the
  // highlight re-derives from the (possibly new) committed dates.
  useEffect(() => {
    setDraftFrom(from);
    setDraftTo(to);
    setForcedCustom(false);
  }, [from, to]);

  const highlight: DateRangeHighlight = forcedCustom ? 'custom' : derivePreset(from, to, today);

  const canApply =
    draftFrom.length > 0 &&
    draftTo.length > 0 &&
    draftFrom <= draftTo &&
    (draftFrom !== from || draftTo !== to);

  function handleSegmentChange(value: DateRangeHighlight): void {
    if (value === 'custom') {
      setForcedCustom(true);
      fromInputRef.current?.focus();
      return;
    }
    const range = computePresetRange(value as DateRangePreset, today);
    onApply(range.from, range.to);
  }

  function handleApply(): void {
    if (!canApply) return;
    onApply(draftFrom, draftTo);
  }

  return (
    <div className="toolbar analytics-toolbar">
      <div className="toolbar__group">
        <SegmentedControl
          aria-label="Date range"
          options={PRESET_OPTIONS}
          value={highlight}
          onChange={handleSegmentChange}
        />
        <label className="analytics-toolbar__field">
          <span className="analytics-toolbar__label">From</span>
          <input
            ref={fromInputRef}
            type="date"
            className="control"
            aria-label="Order date from"
            value={draftFrom}
            onChange={(event) => {
              setForcedCustom(true);
              setDraftFrom(event.target.value);
            }}
          />
        </label>
        <label className="analytics-toolbar__field">
          <span className="analytics-toolbar__label">To</span>
          <input
            type="date"
            className="control"
            aria-label="Order date to"
            value={draftTo}
            onChange={(event) => {
              setForcedCustom(true);
              setDraftTo(event.target.value);
            }}
          />
        </label>
        <Button type="button" tone="secondary" disabled={!canApply} onClick={handleApply}>
          Apply
        </Button>
        {/* Static disclaimer, not an interactive control — a plain chip
          markup rather than the interactive Chip primitive, which would
          render a toggle button that toggles nothing (aria-pressed with
          no onClick). The caveat itself is a Popover on a real <button>,
          not a Tooltip: Radix Tooltip ignores pointerType === 'touch', so
          a Tooltip-only caveat would be permanently unreachable on a phone
          (mirrors the AnalyticsTrustHeader info-popover pattern). */}
        <span className="chip chip--info">
          Order date{' '}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="analytics-gap-mark"
                aria-label={`Order date. ${ORDER_DATE_CAVEAT}`}
              >
                †
              </button>
            </PopoverTrigger>
            <PopoverContent>{ORDER_DATE_CAVEAT}</PopoverContent>
          </Popover>
        </span>
      </div>
    </div>
  );
}
