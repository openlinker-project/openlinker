/**
 * AttributeRulesPanel - component tests (#3995)
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AttributeRulesPanel, type AttributeRulesPanelProps } from './attribute-rules-panel';

function renderPanel(
  over: Partial<AttributeRulesPanelProps> = {},
): ReturnType<typeof render> & { onRetry: ReturnType<typeof vi.fn>; onFix: ReturnType<typeof vi.fn> } {
  const onRetry = vi.fn();
  const onFix = vi.fn();
  const props: AttributeRulesPanelProps = {
    connectionId: 'conn-1',
    destinationName: 'Allegro',
    coverage: [],
    checkedVariantCount: 0,
    rejected: [],
    failedVariantCount: 0,
    onRetry,
    onFix,
    ...over,
  };
  const view = render(
    <MemoryRouter>
      <AttributeRulesPanel {...props} />
    </MemoryRouter>,
  );
  return { ...view, onRetry, onFix };
}

describe('AttributeRulesPanel', () => {
  it('should render nothing when the rules touch nothing and nothing failed', () => {
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('should show one coverage pill per parameter with how many variants it fills', () => {
    renderPanel({
      checkedVariantCount: 3,
      coverage: [
        { parameterId: 'rozmiar', name: 'Rozmiar', segments: ['filled', 'filled', 'filled'] },
        { parameterId: 'kolor', name: 'Kolor', segments: ['filled', 'filled', 'rejected'] },
      ],
    });
    expect(screen.getByLabelText('Rozmiar: filled for 3 of 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Kolor: filled for 2 of 3, 1 not accepted')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage rules' })).toHaveAttribute(
      'href',
      '/connections/conn-1/mappings?tab=attribute-rules',
    );
  });

  it('should list a rejected value with a Fix that opens its variant', async () => {
    const { onFix } = renderPanel({
      checkedVariantCount: 1,
      coverage: [{ parameterId: 'kolor', name: 'Kolor', segments: ['rejected'] }],
      rejected: [
        {
          productId: 'prod-1',
          variantId: 'v-l',
          variantLabel: 'Koszulka Basic, L / Navy',
          parameterName: 'Kolor',
          rawValue: 'Navy',
        },
      ],
    });
    expect(screen.getByText(/Allegro does not accept “Navy”/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fix Kolor for Koszulka Basic, L / Navy' }));
    expect(onFix).toHaveBeenCalledWith('prod-1', 'v-l');
  });

  it('should say when the rules could not be checked, and retry on request', async () => {
    const { onRetry } = renderPanel({ failedVariantCount: 2 });
    expect(screen.getByText(/Could not check the rules for 2 variants/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
