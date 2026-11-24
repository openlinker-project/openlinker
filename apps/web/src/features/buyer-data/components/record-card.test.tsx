/**
 * RecordCard tests (#4289)
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(screen.getByTestId('record-legend-hide')).toHaveTextContent('Hidden after 3 mo.');
    expect(screen.getByTestId('record-legend-erase')).toHaveTextContent('Data erased after 1 yr');
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

  it('should carry everything on one slider with a zone-aware value text', () => {
    card({ defaultAgeDays: 0 });
    const card_ = screen.getByTestId('record-card');
    expect(card_.querySelectorAll('input[type="range"]')).toHaveLength(1);
    expect(screen.getAllByRole('slider')).toHaveLength(1);
    expect(screen.getByTestId('record-age')).toHaveAttribute('aria-valuetext', 'today, visible');
    fireEvent.change(screen.getByTestId('record-age'), { target: { value: '5' } });
    expect(screen.getByTestId('record-age')).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/hidden$/)
    );
    fireEvent.change(screen.getByTestId('record-age'), { target: { value: '33' } });
    expect(screen.getByTestId('record-age')).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/hidden, data erased$/)
    );
  });

  it('should swap the zone badge when the thumb crosses a cut', () => {
    card({ defaultAgeDays: 0 });
    expect(screen.getByTestId('record-zone')).toHaveTextContent('Visible');
    fireEvent.change(screen.getByTestId('record-age'), { target: { value: '5' } });
    expect(screen.getByTestId('record-zone')).toHaveTextContent('Hidden');
    fireEvent.change(screen.getByTestId('record-age'), { target: { value: '20' } });
    expect(screen.getByTestId('record-zone')).toHaveTextContent('Hidden, data erased');
  });

  it('should offer three stage presets that jump the slider and the card', () => {
    card({ defaultAgeDays: 0 });
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByTestId('record-stage-today')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('record-stage-afterHide'));
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'hidden');
    expect(screen.getByTestId('record-stage-afterHide')).toHaveAttribute('aria-checked', 'true');
    expect(Number(screen.getByTestId('record-age').getAttribute('value'))).toBeGreaterThan(3);
    fireEvent.click(screen.getByTestId('record-stage-afterErase'));
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'hidden-erased');
    fireEvent.click(screen.getByTestId('record-stage-today'));
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'visible');
  });

  it('should follow the slider with the selected stage', () => {
    card({ defaultAgeDays: 0 });
    fireEvent.change(screen.getByTestId('record-age'), { target: { value: '20' } });
    expect(screen.getByTestId('record-stage-afterErase')).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByTestId('record-age'), { target: { value: '5' } });
    expect(screen.getByTestId('record-stage-afterHide')).toHaveAttribute('aria-checked', 'true');
  });

  it('should disable a stage whose cut is never and say why', () => {
    card({ hideAfterDays: 0, eraseAfterDays: 0, defaultAgeDays: 0 });
    expect(screen.getByTestId('record-stage-afterHide')).toBeDisabled();
    expect(screen.getByTestId('record-stage-afterErase')).toBeDisabled();
    expect(screen.getByText(/Hiding is switched off/)).toBeInTheDocument();
    expect(screen.getByText(/Erasing data is switched off/)).toBeInTheDocument();
    expect(screen.getByTestId('record-legend-hide')).toHaveTextContent('Hiding: never');
    expect(screen.getByTestId('record-legend-erase')).toHaveTextContent('Erasing data: never');
  });

  it('should aim the hide preset past the hide cut when erasing is never', () => {
    card({ eraseAfterDays: 0, defaultAgeDays: 0 });
    expect(screen.getByTestId('record-stage-afterErase')).toBeDisabled();
    fireEvent.click(screen.getByTestId('record-stage-afterHide'));
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'hidden');
  });

  it('should cover the rows with a skeleton while a handle is dragged and keep the last values', () => {
    const { rerender } = renderWithProviders(
      <RecordCard
        hideAfterDays={90}
        eraseAfterDays={365}
        mode="personal-data"
        handleAgeDays={null}
        defaultAgeDays={120}
      />
    );
    expect(screen.getByTestId('record-rows')).not.toHaveAttribute('data-loading');
    rerender(
      <RecordCard
        hideAfterDays={90}
        eraseAfterDays={365}
        mode="personal-data"
        handleAgeDays={400}
        defaultAgeDays={120}
        dragging
      />
    );
    expect(screen.getByTestId('record-rows')).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('record-card')).toHaveAttribute('aria-busy', 'true');
    // No flicker through intermediate values: the body still shows the grab-time state ...
    expect(screen.getByTestId('record-card')).toHaveAttribute('data-state', 'hidden');
    // ... while the footer slider stays live.
    expect(screen.getByTestId('record-age')).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/hidden, data erased$/)
    );
    rerender(
      <RecordCard
        hideAfterDays={90}
        eraseAfterDays={365}
        mode="personal-data"
        handleAgeDays={null}
        defaultAgeDays={120}
        dragging={false}
      />
    );
    expect(screen.getByTestId('record-rows')).not.toHaveAttribute('data-loading');
    expect(screen.getByTestId('record-rows')).toHaveClass('record-card__rows--reveal');
  });

  it('should report an age picked on the slider or a preset to the owner', () => {
    const onAgeChange = vi.fn();
    card({ defaultAgeDays: 0, ageDays: 0, onAgeChange });
    fireEvent.change(screen.getByTestId('record-age'), { target: { value: '5' } });
    expect(onAgeChange).toHaveBeenLastCalledWith(150);
    fireEvent.click(screen.getByTestId('record-stage-afterErase'));
    expect(onAgeChange).toHaveBeenCalledTimes(2);
  });
});
