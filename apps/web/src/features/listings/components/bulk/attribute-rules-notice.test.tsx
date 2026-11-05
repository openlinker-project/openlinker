/**
 * AttributeRulesNotice - component tests (#3995)
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AttributeRulesNotice, type AttributeRulesNoticeProps } from './attribute-rules-notice';

function renderNotice(
  over: Partial<AttributeRulesNoticeProps> = {},
): ReturnType<typeof render> & { onRetry: ReturnType<typeof vi.fn> } {
  const onRetry = vi.fn();
  const props: AttributeRulesNoticeProps = {
    connectionId: 'conn-1',
    destinationName: 'Allegro',
    filledCount: 0,
    filledVariantCount: 0,
    rejected: [],
    failedVariantCount: 0,
    onRetry,
    ...over,
  };
  const view = render(
    <MemoryRouter>
      <AttributeRulesNotice {...props} />
    </MemoryRouter>,
  );
  return { ...view, onRetry };
}

describe('AttributeRulesNotice', () => {
  it('should render nothing when the rules fill nothing', () => {
    const { container } = renderNotice();
    expect(container).toBeEmptyDOMElement();
  });

  it('should say how many parameters the rules fill and link to the rules', () => {
    renderNotice({ filledCount: 15, filledVariantCount: 3 });
    expect(screen.getByText('Your attribute rules fill 15 parameters on 3 variants')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Attribute rules' })).toHaveAttribute(
      'href',
      '/connections/conn-1/mappings?tab=attribute-rules',
    );
  });

  it('should name each rule value the destination will not accept', () => {
    renderNotice({
      filledCount: 4,
      filledVariantCount: 1,
      rejected: [
        {
          variantLabel: 'Koszulka Basic, L / Navy',
          origin: {
            parameterId: 'p-color',
            parameterName: 'Kolor',
            section: 'product',
            source: 'rule',
            rawValue: 'Navy',
            outcome: 'rejected',
          },
        },
      ],
    });
    expect(screen.getByText('1 rule value not accepted by Allegro')).toBeInTheDocument();
    expect(screen.getByText(/"Navy" for Koszulka Basic, L \/ Navy/)).toBeInTheDocument();
    expect(screen.getByText('Your attribute rules fill 4 parameters on 1 variant')).toBeInTheDocument();
  });

  it('should report a failed check instead of a count, and retry on request', async () => {
    const { onRetry } = renderNotice({ filledCount: 5, filledVariantCount: 1, failedVariantCount: 2 });
    expect(screen.getByText('Attribute rules could not be checked for 2 variants')).toBeInTheDocument();
    expect(screen.queryByText(/Your attribute rules fill/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
