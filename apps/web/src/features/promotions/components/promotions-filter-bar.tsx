/**
 * PromotionsFilterBar (#3935, mockup `promotions-list` toolbar)
 *
 * Search (focused by `/`), the joined Channel / Benefit filter, the applied
 * filter as a pill and, on the right, the hint that promotions are checked top
 * to bottom with the result count. Status is not here: the tabs own it. Every
 * value lives in the URL; this only renders and calls back.
 *
 * @module apps/web/src/features/promotions/components
 */
import { useEffect, useRef, type ReactElement } from 'react';
import { useMessages, usePlural } from '../../../shared/i18n';
import { ActiveFilterChips, type ActiveFilterChip } from '../../../shared/ui/active-filter-chips';
import { FilterDropdown, FilterGroup } from '../../../shared/ui/filter-dropdown';
import { Input } from '../../../shared/ui/input';

export type PromotionBenefitFilter = 'gift';

export interface PromotionsFilterBarProps {
  query: string;
  onQueryChange: (next: string) => void;
  channels: readonly { id: string; name: string; count: number }[];
  channelId: string | null;
  onChannelChange: (next: string | null) => void;
  benefit: PromotionBenefitFilter | null;
  benefitCount: number;
  onBenefitChange: (next: PromotionBenefitFilter | null) => void;
  /** `null` while unknown. */
  resultCount: number | null;
  onClearAll: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

export function PromotionsFilterBar({
  query,
  onQueryChange,
  channels,
  channelId,
  onChannelChange,
  benefit,
  benefitCount,
  onBenefitChange,
  resultCount,
  onClearAll,
}: PromotionsFilterBarProps): ReactElement {
  const copy = useMessages('promotions');
  const plural = usePlural();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('keydown', onKeydown);
    };
  }, []);

  const chips: ActiveFilterChip[] = [];
  const channelName = channels.find((c) => c.id === channelId)?.name;
  if (channelId !== null && channelName !== undefined) {
    chips.push({
      key: 'channel',
      label: copy.toolbar.channel,
      value: channelName,
      valueText: channelName,
      onRemove: () => {
        onChannelChange(null);
      },
    });
  }
  if (benefit !== null) {
    chips.push({
      key: 'benefit',
      label: copy.toolbar.benefit,
      value: copy.toolbar.benefitGift,
      valueText: copy.toolbar.benefitGift,
      onRemove: () => {
        onBenefitChange(null);
      },
    });
  }

  return (
    <div className="list-filters">
      <div className="list-toolbar">
        <div className="list-search">
          <span className="list-search__glyph" aria-hidden="true">
            ⌕
          </span>
          <Input
            ref={searchRef}
            type="search"
            aria-label={copy.toolbar.search}
            placeholder={copy.toolbar.search}
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
            }}
            data-testid="promotions-search"
          />
          <span className="button__shortcut list-search__kbd" aria-hidden="true">
            /
          </span>
        </div>
        <FilterGroup aria-label={copy.toolbar.filtersAria}>
          <FilterDropdown
            label={copy.toolbar.channel}
            anyLabel={copy.toolbar.anyChannel}
            value={channelId}
            options={channels.map((c) => ({ value: c.id, label: c.name, count: c.count }))}
            onChange={onChannelChange}
          />
          <FilterDropdown<PromotionBenefitFilter>
            label={copy.toolbar.benefit}
            anyLabel={copy.toolbar.anyBenefit}
            value={benefit}
            options={[{ value: 'gift', label: copy.toolbar.benefitGift, count: benefitCount }]}
            onChange={onBenefitChange}
          />
        </FilterGroup>
        <span className="list-toolbar__spacer" />
        <span className="pm-hint">{copy.toolbar.checkedInOrder}</span>
        <span className="text-muted mono tabular list-results" aria-live="polite">
          {resultCount === null ? null : plural(resultCount, copy.toolbar.results)}
        </span>
      </div>
      <ActiveFilterChips chips={chips} onClearAll={onClearAll} onEmptyFocus={() => undefined} clearAllLabel={copy.toolbar.clear} />
    </div>
  );
}
