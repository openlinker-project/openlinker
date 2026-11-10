/**
 * PromotionNew tests (#3935, mockup `promotions-new`)
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { PromotionNew } from './promotion-new';

const allegro = { ...sampleConnection, id: 'c-allegro', name: 'Allegro shop', platformType: 'allegro', enabledCapabilities: ['OrderSource'] };

function mount(onSave = vi.fn()): ReturnType<typeof vi.fn> {
  const apiClient = createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue([allegro]) },
    products: { getVariantCosts: vi.fn().mockResolvedValue([]), listRows: vi.fn().mockResolvedValue({ items: [] }) },
  } as never);
  renderWithProviders(
    <PromotionNew all={[]} canWrite saving={false} savedCount={0} saveError={null} onSave={onSave} />,
    { apiClient },
  );
  return onSave;
}

afterEach(cleanup);

describe('PromotionNew', () => {
  it('should start from the benefit type and the templates, and open the form on a choice', () => {
    mount();

    expect(screen.getByTestId('promotion-templates')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('promotion-template-product'));

    expect(screen.getByTestId('promotion-new-form')).toBeInTheDocument();
    expect(screen.getByTestId('promotion-kind-product')).toHaveAttribute('aria-checked', 'true');
  });

  it('should go back to the templates from the form', () => {
    mount();
    fireEvent.click(screen.getByTestId('promotion-template-basket'));

    fireEvent.click(screen.getByTestId('promotion-change-template'));

    expect(screen.getByTestId('promotion-templates')).toBeInTheDocument();
  });

  it('should list what is missing in the action bar and refuse to save until it is filled in', async () => {
    const onSave = mount();
    fireEvent.click(screen.getByTestId('promotion-template-basket'));

    expect(screen.getByText('name, amount, gift product')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('promotion-primary'));

    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('promotion-name').closest('.form-field')).toHaveClass('is-invalid'),
    );
  });

  it('should offer the suggestion for the name only after a gift is chosen, never fill it silently', () => {
    mount();
    fireEvent.click(screen.getByTestId('promotion-template-basket'));

    expect(screen.queryByTestId('promotion-name-use-suggestion')).not.toBeInTheDocument();
    expect(screen.getByTestId<HTMLInputElement>('promotion-name').value).toBe('');
  });
});
