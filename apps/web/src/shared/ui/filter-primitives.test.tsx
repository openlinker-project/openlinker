/**
 * Filter primitives (#3507) — FilterToggleButton, FilterPanel/FilterGroup,
 * FilterCheck, ActiveFilterChips, FilterSheet/FilterSection, BareIconButton.
 */
import { useState, type ReactElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActiveFilterChips, type ActiveFilterChip } from './active-filter-chips';
import { BareIconButton } from './bare-icon-button';
import { FilterCheck } from './filter-check';
import { FilterField, FilterGroup, FilterPanel } from './filter-panel';
import { FilterSection, FilterSheet } from './filter-sheet';
import { FilterToggleButton } from './filter-toggle-button';

afterEach(cleanup);

describe('FilterToggleButton', () => {
  it('should expose aria-expanded and aria-controls when it discloses a panel', () => {
    render(<FilterToggleButton expanded={false} count={0} controls="panel-1" />);
    const button = screen.getByRole('button', { name: /^Filters/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'panel-1');
  });

  it('should announce the active count when filters are active', () => {
    render(<FilterToggleButton expanded count={3} />);
    expect(screen.getByRole('button', { name: 'Filters 3 active' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('should render no count badge when nothing is active', () => {
    const { container } = render(<FilterToggleButton expanded={false} count={0} />);
    expect(container.querySelector('.filter-toggle__count')).toBeNull();
  });
});

describe('FilterPanel', () => {
  it('should render a named region whose groups are fieldsets with legends', () => {
    render(
      <FilterPanel id="p">
        <FilterGroup legend="Shipment">
          <FilterField label="Fulfillment">
            <select aria-label="Fulfillment" />
          </FilterField>
        </FilterGroup>
      </FilterPanel>,
    );
    const region = screen.getByRole('region', { name: 'Filters' });
    expect(region).toHaveAttribute('id', 'p');
    expect(screen.getByRole('group', { name: 'Shipment' }).tagName).toBe('FIELDSET');
  });
});

describe('FilterCheck', () => {
  it('should render its count as text when a count is given', () => {
    render(<FilterCheck label="Rate conflict" count={4} tone="error" onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /Rate conflict/ })).toBeInTheDocument();
    expect(screen.getByText('4')).toHaveClass('filter-check__count');
  });

  it('should render no count when the count is unknown', () => {
    const { container } = render(<FilterCheck label="Open return" onChange={() => {}} />);
    expect(container.querySelector('.filter-check__count')).toBeNull();
  });

  it('should render a radio when type is radio', () => {
    render(<FilterCheck type="radio" name="t" label="Any tag" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Any tag' })).toBeInTheDocument();
  });
});

function ChipsHarness({ onEmpty }: { onEmpty: () => void }): ReactElement {
  const [keys, setKeys] = useState(['source', 'fulfillment', 'tag']);
  const chips: ActiveFilterChip[] = keys.map((key) => ({
    key,
    label: key,
    value: `${key}-value`,
    valueText: `${key}-value`,
    onRemove: () => {
      setKeys((prev) => prev.filter((k) => k !== key));
    },
  }));
  return <ActiveFilterChips chips={chips} onClearAll={() => setKeys([])} onEmptyFocus={onEmpty} />;
}

describe('ActiveFilterChips', () => {
  it('should render nothing when no filter is active', () => {
    const { container } = render(<ActiveFilterChips chips={[]} onClearAll={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('should call onRemove with the chip when its remove button is pressed', () => {
    const onRemove = vi.fn();
    render(
      <ActiveFilterChips
        chips={[{ key: 'source', label: 'Source', value: 'Allegro', valueText: 'Allegro', onRemove }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter Source: Allegro' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('should move focus to the next chip when a chip is removed', async () => {
    render(<ChipsHarness onEmpty={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter source: source-value' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove filter fulfillment: fulfillment-value' })).toHaveFocus();
    });
  });

  it('should call onEmptyFocus when the last chip is removed', async () => {
    const onEmpty = vi.fn();
    render(<ChipsHarness onEmpty={onEmpty} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter source: source-value' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter fulfillment: fulfillment-value' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter tag: tag-value' }));
    await waitFor(() => {
      expect(onEmpty).toHaveBeenCalled();
    });
  });

  it('should call onClearAll when Clear all is pressed', () => {
    const onClearAll = vi.fn();
    render(
      <ActiveFilterChips
        chips={[{ key: 'a', label: 'A', value: 'x', valueText: 'x', onRemove: () => {} }]}
        onClearAll={onClearAll}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});

describe('FilterSheet', () => {
  it('should render a modal dialog with the sheet modifier when open', () => {
    render(
      <FilterSheet open onOpenChange={() => {}} footer={<button type="button">Show orders</button>}>
        <FilterSection title="Shipment" summary="Not shipped" active defaultOpen>
          <span>body</span>
        </FilterSection>
      </FilterSheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog).toHaveClass('dialog__content--sheet');
    expect(screen.getByText('Not shipped')).toHaveClass('filter-section__summary--on');
    expect(screen.getByRole('button', { name: 'Show orders' })).toBeInTheDocument();
  });

  it('should ask to close when Escape is pressed', () => {
    const onOpenChange = vi.fn();
    render(
      <FilterSheet open onOpenChange={onOpenChange}>
        <span>body</span>
      </FilterSheet>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should ask to close when the close button is pressed', () => {
    const onOpenChange = vi.fn();
    render(
      <FilterSheet open onOpenChange={onOpenChange}>
        <span>body</span>
      </FilterSheet>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('BareIconButton', () => {
  it('should carry the bare modifier and an accessible name when rendered', () => {
    render(<BareIconButton label="Remove tag VIP" />);
    const button = screen.getByRole('button', { name: 'Remove tag VIP' });
    expect(button).toHaveClass('button--bare');
    expect(button).toHaveAttribute('type', 'button');
  });
});
