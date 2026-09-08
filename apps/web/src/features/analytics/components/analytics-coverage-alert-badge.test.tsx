import { screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { AnalyticsCoverageAlertBadge, ANALYTICS_DATA_COVERAGE_ANCHOR_ID } from './analytics-coverage-alert-badge';
import type { CoverageCategoryRow } from '../api/analytics-coverage.types';

function makeRow(overrides: Partial<CoverageCategoryRow> = {}): CoverageCategoryRow {
  return {
    category: 'currency',
    status: 'open',
    affectedCount: 0,
    sampleOrderIds: [],
    ...overrides,
  };
}

describe('AnalyticsCoverageAlertBadge', () => {
  it('should render nothing when categories is undefined', () => {
    renderWithProviders(<AnalyticsCoverageAlertBadge categories={undefined} />);

    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
  });

  it('should render nothing when no row is actionable', () => {
    renderWithProviders(
      <AnalyticsCoverageAlertBadge
        categories={[
          makeRow({ category: 'tax-b', affectedCount: 3 }),
          makeRow({ category: 'currency', affectedCount: 0 }),
        ]}
      />
    );

    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
  });

  it('should render the badge when an Action-labelled row has affected orders', () => {
    renderWithProviders(
      <AnalyticsCoverageAlertBadge categories={[makeRow({ category: 'currency', affectedCount: 5 })]} />
    );

    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('should render the badge when a row failed, even with zero affected orders', () => {
    renderWithProviders(
      <AnalyticsCoverageAlertBadge
        categories={[makeRow({ category: 'currency', status: 'failed', affectedCount: 0 })]}
      />
    );

    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('should open a popover with a CTA to scroll to the coverage panel', () => {
    const target = document.createElement('div');
    target.id = ANALYTICS_DATA_COVERAGE_ANCHOR_ID;
    target.scrollIntoView = (): void => {};
    document.body.appendChild(target);

    renderWithProviders(
      <AnalyticsCoverageAlertBadge categories={[makeRow({ category: 'currency', affectedCount: 5 })]} />
    );

    fireEvent.click(screen.getByText('Needs attention'));
    const cta = screen.getByRole('button', { name: 'Go to Data Coverage' });
    expect(cta).toBeInTheDocument();
    expect(() => fireEvent.click(cta)).not.toThrow();
  });
});
