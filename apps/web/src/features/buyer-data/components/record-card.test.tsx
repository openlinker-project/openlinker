/**
 * RecordCard tests (#4289)
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
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
  it('should show today and after-the-rules columns and look ordinary before the hide cut', () => {
    card({ defaultAgeDays: 30 });
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'visible');
    expect(screen.getByTestId('record-ribbon')).toHaveTextContent('On the list');
    expect(screen.getByTestId('record-timeline')).toHaveTextContent('Hidden after 3 mo.');
    expect(screen.getByTestId('record-timeline')).toHaveTextContent('Erased after 1 yr');
    expect(screen.queryByTestId('record-now-email')).not.toBeInTheDocument();
    expect(screen.getByTestId('record-field-email')).toHaveTextContent('magdalena.wrona@');
  });

  it('should mark the order hidden past the hide cut and keep the data', () => {
    card({ defaultAgeDays: 120 });
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'hidden');
    expect(screen.getByTestId('record-ribbon')).toHaveTextContent('can be restored');
    expect(screen.getByTestId('record-field-visibility')).toHaveTextContent('hidden');
    expect(screen.getByTestId('record-field-email')).toHaveTextContent('magdalena.wrona@');
  });

  it('should strike the personal fields today and redact them after the erase cut', () => {
    card({ defaultAgeDays: 400 });
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'hidden-erased');
    expect(screen.getByTestId('record-field-buyer')).toHaveTextContent('BUYER-000123');
    for (const id of ['email', 'phone', 'address', 'note', 'taxId']) {
      expect(screen.getByTestId(`record-field-${id}`)).toHaveTextContent('█████');
      expect(screen.getByTestId(`record-now-${id}`)).toHaveClass('record-card__old');
    }
    expect(screen.getByTestId('record-field-amount')).toHaveTextContent('249.00 PLN');
    expect(
      screen.getByTestId('record-field-invoice').closest('[role="listitem"]')
    ).toHaveTextContent('stays');
    expect(screen.getByTestId('record-field-orderRef')).toHaveTextContent('6c1f0e3a');
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
});
