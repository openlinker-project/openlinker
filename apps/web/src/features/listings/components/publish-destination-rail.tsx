/**
 * PublishDestinationRail
 *
 * Single-select destination picker for the unified publish flow (#1828),
 * grouped by kind (Marketplaces / Online shops) with a capability-driven hint
 * (never a `platformType` literal). Shared by the Listings picker
 * (`OfferProductPickerModal`) and the Products picker
 * (`MarketplacePickerModal`) so the grouped-radio markup and its keyboard a11y
 * live in one place.
 *
 * Uses the WAI-ARIA radiogroup idiom (`role="radiogroup"` + `role="radio"` /
 * `aria-checked`): a roving tabindex keeps the whole group a single tab stop,
 * and Arrow / Home / End move (and select) between destinations - mirroring the
 * `SegmentedControl` primitive. Selection follows the flattened visual order
 * (marketplaces first, then shops), which is the order `destinations` already
 * arrives in from `selectPublishDestinations`.
 *
 * @module apps/web/src/features/listings/components
 */
import { useRef, type KeyboardEvent, type ReactElement } from 'react';

import {
  PUBLISH_DESTINATION_GROUP_LABEL,
  PUBLISH_DESTINATION_KIND_HINT,
  PUBLISH_DESTINATION_KIND_ORDER,
  type PublishDestination,
} from '../lib/publish-destinations';

interface PublishDestinationRailProps {
  destinations: readonly PublishDestination[];
  selectedConnectionId: string | null;
  onSelect: (connectionId: string) => void;
  /** Accessible name for the group; omit when using `labelledBy` instead. */
  ariaLabel?: string;
  /** Id of an external element labelling the group (takes precedence visually). */
  labelledBy?: string;
}

export function PublishDestinationRail({
  destinations,
  selectedConnectionId,
  onSelect,
  ariaLabel,
  labelledBy,
}: PublishDestinationRailProps): ReactElement {
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Flatten to visual/tab order (marketplaces first, then shops), so the
  // radio index used for roving tabindex + arrow nav matches what the operator
  // sees. `destinations` already arrives sorted this way; re-project defensively.
  const ordered: PublishDestination[] = PUBLISH_DESTINATION_KIND_ORDER.flatMap((kind) =>
    destinations.filter((d) => d.kind === kind),
  );
  const hasSelected = ordered.some((d) => d.connection.id === selectedConnectionId);

  const selectAt = (index: number): void => {
    const next = ordered[index];
    if (next === undefined) return;
    onSelect(next.connection.id);
    optionRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const count = ordered.length;
    if (count === 0) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        selectAt((index + 1) % count);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        selectAt((index - 1 + count) % count);
        break;
      case 'Home':
        event.preventDefault();
        selectAt(0);
        break;
      case 'End':
        event.preventDefault();
        selectAt(count - 1);
        break;
      default:
        break;
    }
  };

  let flatIndex = -1;

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : (ariaLabel ?? 'Publish destination')}
      aria-labelledby={labelledBy}
      className="publish-dest-rail"
    >
      {PUBLISH_DESTINATION_KIND_ORDER.map((kind) => {
        const inKind = destinations.filter((d) => d.kind === kind);
        if (inKind.length === 0) return null;
        return (
          <div key={kind} className="publish-dest-rail__kind">
            <div className="publish-dest-rail__group">{PUBLISH_DESTINATION_GROUP_LABEL[kind]}</div>
            {inKind.map((d) => {
              flatIndex += 1;
              const index = flatIndex;
              const selected = selectedConnectionId === d.connection.id;
              return (
                <button
                  key={d.connection.id}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  // Roving tabindex: the whole group is one tab stop. The
                  // selected option is tabbable; with nothing selected the first
                  // option (index 0) takes the stop so the group is reachable.
                  tabIndex={selected || (!hasSelected && index === 0) ? 0 : -1}
                  className={`publish-dest-rail__option${
                    selected ? ' publish-dest-rail__option--selected' : ''
                  }`}
                  onClick={() => onSelect(d.connection.id)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                >
                  <span className="publish-dest-rail__meta">
                    <span className="publish-dest-rail__name">{d.connection.name}</span>
                    <span className="publish-dest-rail__kind-hint">
                      {PUBLISH_DESTINATION_KIND_HINT[d.kind]}
                    </span>
                  </span>
                  <span className="publish-dest-rail__radio" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
