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
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useMessages } from '../../../shared/i18n';
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
  /** Rendered as a second, right-aligned `toolbar__group` (#2472 — the currency picker). */
  trailing?: ReactNode;
}

// The order-date caveat (`orderDateCaveat`) is operator-facing: no schema
// jargon (no "placedAt", no "column"). The underlying reason is that
// `placedAt` isn't yet a filterable read-model column - tracked for #1990 -
// but that's a developer fact, not one an operator can act on.

export function AnalyticsDateRangeToolbar({
  from,
  to,
  onApply,
  trailing,
}: AnalyticsDateRangeToolbarProps): ReactElement {
  const copy = useMessages('analytics').analyticsDateRangeToolbar;
  const presetOptions = useMemo<readonly { value: DateRangeHighlight; label: string }[]>(
    () => [
      { value: '7d', label: copy.presets.last7Days },
      { value: '30d', label: copy.presets.last30Days },
      { value: '90d', label: copy.presets.last90Days },
      { value: 'custom', label: copy.presets.custom },
    ],
    [copy]
  );
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
          aria-label={copy.dateRange}
          options={presetOptions}
          value={highlight}
          onChange={handleSegmentChange}
        />
        <label className="analytics-toolbar__field">
          <span className="analytics-toolbar__label">{copy.from}</span>
          <input
            ref={fromInputRef}
            type="date"
            className="control"
            aria-label={copy.fromAria}
            data-analytics-range-from=""
            value={draftFrom}
            onChange={(event) => {
              setForcedCustom(true);
              setDraftFrom(event.target.value);
            }}
          />
        </label>
        <label className="analytics-toolbar__field">
          <span className="analytics-toolbar__label">{copy.to}</span>
          <input
            type="date"
            className="control"
            aria-label={copy.toAria}
            value={draftTo}
            onChange={(event) => {
              setForcedCustom(true);
              setDraftTo(event.target.value);
            }}
          />
        </label>
        <Button type="button" tone="secondary" disabled={!canApply} onClick={handleApply}>
          {copy.apply}
        </Button>
        {/* Static disclaimer, not an interactive control — a plain chip
          markup rather than the interactive Chip primitive, which would
          render a toggle button that toggles nothing (aria-pressed with
          no onClick). The caveat itself is a Popover on a real <button>,
          not a Tooltip: Radix Tooltip ignores pointerType === 'touch', so
          a Tooltip-only caveat would be permanently unreachable on a phone
          (mirrors the AnalyticsTrustHeader info-popover pattern). */}
        <span className="chip chip--info">
          {copy.orderDate}{' '}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="analytics-gap-mark"
                aria-label={copy.orderDateCaveatAria}
              >
                {'\u2020'}
              </button>
            </PopoverTrigger>
            <PopoverContent>{copy.orderDateCaveat}</PopoverContent>
          </Popover>
        </span>
      </div>
      {trailing ? <div className="toolbar__group">{trailing}</div> : null}
    </div>
  );
}
