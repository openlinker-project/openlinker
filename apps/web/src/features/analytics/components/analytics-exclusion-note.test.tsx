import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsExclusionNote } from './analytics-exclusion-note';
import { deriveCoverageRowCopy } from '../lib/data-coverage-copy.lib';
import { COVERAGE_CATEGORY_VALUES, type CoverageCategory } from '../api/analytics-coverage.types';

describe('AnalyticsExclusionNote (#2481)', () => {
  it.each(COVERAGE_CATEGORY_VALUES)('renders the %s category copy from deriveCoverageRowCopy verbatim', (category) => {
    render(
      <AnalyticsExclusionNote category={category as CoverageCategory} affectedCount={3} onOpenCategory={() => {}} />
    );

    const expected = deriveCoverageRowCopy({
      category: category as CoverageCategory,
      status: 'open',
      affectedCount: 3,
      sampleOrderIds: [],
    }).headline;

    expect(screen.getByRole('button', { name: expected })).toBeInTheDocument();
  });

  it('calls onOpenCategory with its own category when clicked', async () => {
    const user = userEvent.setup();
    const onOpenCategory = vi.fn();

    render(<AnalyticsExclusionNote category="tax-b" affectedCount={1} onOpenCategory={onOpenCategory} />);

    await user.click(screen.getByRole('button'));

    expect(onOpenCategory).toHaveBeenCalledWith('tax-b');
    expect(onOpenCategory).toHaveBeenCalledTimes(1);
  });
});
