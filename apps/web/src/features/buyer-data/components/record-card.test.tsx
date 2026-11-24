/**
 * RecordCard tests (#4289)
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { RecordCard, type RecordCardProps } from './record-card';

function card(props: Partial<RecordCardProps> = {}): void {
  renderWithProviders(
    <RecordCard
      hideAfterDays={90}
      eraseAfterDays={365}
      mode="personal-data"
      handleAgeDays={null}
      defaultAgeDays={0}
      {...props}
    />
  );
}

afterEach(cleanup);

describe('RecordCard (#4289)', () => {
  it('should look like an ordinary order before the hide cut', () => {
    card({ defaultAgeDays: 30 });
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'visible');
    expect(screen.getByTestId('record-ribbon')).toHaveTextContent('On the list');
    expect(screen.getByTestId('record-field-email')).toHaveTextContent('john.smith@example.com');
  });

  it('should mark the order hidden past the hide cut and keep the data', () => {
    card({ defaultAgeDays: 120 });
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'hidden');
    expect(screen.getByTestId('record-ribbon')).toHaveTextContent('can be restored');
    expect(screen.getByTestId('record-field-email')).toHaveTextContent('john.smith@example.com');
  });

  it('should redact the personal fields past the erase cut and lock the rows that stay', () => {
    card({ defaultAgeDays: 400 });
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'hidden-erased');
    expect(screen.getByTestId('record-field-buyer')).toHaveTextContent('BUYER-000123');
    for (const id of ['email', 'phone', 'address', 'note', 'taxId']) {
      expect(screen.getByTestId(`record-field-${id}`)).toHaveTextContent('█████');
    }
    expect(screen.getByTestId('record-field-amount')).toHaveTextContent('249.00 PLN');
    expect(screen.getByTestId('record-field-invoice')).toHaveTextContent(
      'stays: needed for the books'
    );
    expect(screen.getByTestId('record-field-orderRef')).toHaveTextContent('OL-91240');
  });

  it('should keep the order on the list in personal-data mode with hiding off', () => {
    card({ hideAfterDays: 0, defaultAgeDays: 400 });
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'visible-erased');
  });

  it('should hide the order at erase time in whole-order mode', () => {
    card({ hideAfterDays: 0, mode: 'whole-order', defaultAgeDays: 400 });
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'hidden-erased');
  });

  it('should follow a handle while it is grabbed, ahead of the slider', () => {
    card({ defaultAgeDays: 0, handleAgeDays: 400 });
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'hidden-erased');
    expect(screen.getByText(/Age from the handle/)).toBeInTheDocument();
  });

  it('should follow its own age slider', () => {
    card({ defaultAgeDays: 0 });
    fireEvent.change(screen.getByTestId('record-age'), { target: { value: '5' } });
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'hidden');
  });

  it('should snap back to today while the hold button is pressed', () => {
    card({ defaultAgeDays: 400 });
    const hold = screen.getByTestId('record-hold');
    fireEvent.pointerDown(hold);
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'visible');
    fireEvent.pointerUp(hold);
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'hidden-erased');
  });

  it('should show the protected example untouched by the handles', async () => {
    card({ defaultAgeDays: 0, handleAgeDays: 900 });
    await userEvent.click(screen.getByRole('radio', { name: 'Protected' }));
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'protected');
    expect(screen.getByTestId('record-ribbon')).toHaveTextContent('Skipped: open return');
    expect(screen.getByTestId('record-field-email')).toHaveTextContent('john.smith@example.com');
    expect(screen.queryByTestId('record-age')).not.toBeInTheDocument();
  });
});
