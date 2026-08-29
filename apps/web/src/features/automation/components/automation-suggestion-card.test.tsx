/**
 * Suggestion card tests (#2364, spec §5.1)
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { AutomationSuggestionCard } from './automation-suggestion-card';

describe('AutomationSuggestionCard', () => {
  it('should render the §5.1 copy verbatim', () => {
    renderWithProviders(
      <AutomationSuggestionCard onSetUp={vi.fn()} onStartFromScratch={vi.fn()} />,
    );

    expect(screen.getByText('You have no automations yet.')).toBeInTheDocument();
    expect(screen.getByText('Most sellers start with this one:')).toBeInTheDocument();
    expect(
      screen.getByText(
        'When an order is marked packed → buy the shipping label → tell the marketplace.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'One click at the packing bench instead of three, and the marketplace hears about it straight away.',
      ),
    ).toBeInTheDocument();
  });

  it('should offer exactly one suggestion, deliberately', () => {
    renderWithProviders(
      <AutomationSuggestionCard onSetUp={vi.fn()} onStartFromScratch={vi.fn()} />,
    );
    // A menu of starting points is a second index, which is what this card
    // exists to avoid being.
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('should state that opening the page creates nothing', () => {
    renderWithProviders(
      <AutomationSuggestionCard onSetUp={vi.fn()} onStartFromScratch={vi.fn()} />,
    );
    expect(screen.getByText(/Nothing is created by opening this page/)).toBeInTheDocument();
  });

  it('should route both actions without creating a rule', async () => {
    const user = userEvent.setup();
    const onSetUp = vi.fn();
    const onStartFromScratch = vi.fn();
    renderWithProviders(
      <AutomationSuggestionCard onSetUp={onSetUp} onStartFromScratch={onStartFromScratch} />,
    );

    await user.click(screen.getByRole('button', { name: 'Set this up' }));
    expect(onSetUp).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Start from scratch' }));
    expect(onStartFromScratch).toHaveBeenCalledTimes(1);
  });
});
