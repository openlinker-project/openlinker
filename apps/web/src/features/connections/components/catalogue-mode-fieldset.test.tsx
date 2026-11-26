/**
 * CatalogueModeFieldset tests (#4281)
 *
 * @module apps/web/src/features/connections/components
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { CatalogueModeFieldset } from './catalogue-mode-fieldset';

describe('CatalogueModeFieldset', () => {
  it('should group both choices in a fieldset named by its legend', () => {
    renderWithProviders(
      <CatalogueModeFieldset value="linked" disabled={false} onChange={vi.fn()}>
        <div>master picker</div>
      </CatalogueModeFieldset>,
    );

    expect(screen.getByRole('group', { name: 'Product catalog' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('should show the picker, not the notice, while linked', () => {
    renderWithProviders(
      <CatalogueModeFieldset value="linked" disabled={false} onChange={vi.fn()}>
        <div>master picker</div>
      </CatalogueModeFieldset>,
    );

    expect(screen.getByText('master picker')).toBeInTheDocument();
    expect(screen.queryByText(/not matched to products/)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Linked to a catalog/ })).toBeChecked();
  });

  it('should replace the picker with the notice while none', () => {
    renderWithProviders(
      <CatalogueModeFieldset value="none" disabled={false} onChange={vi.fn()}>
        <div>master picker</div>
      </CatalogueModeFieldset>,
    );

    expect(screen.queryByText('master picker')).not.toBeInTheDocument();
    expect(screen.getByText(/not matched to products/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^No catalog/ })).toBeChecked();
  });

  it('should report the chosen mode', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <CatalogueModeFieldset value="linked" disabled={false} onChange={onChange}>
        <div>master picker</div>
      </CatalogueModeFieldset>,
    );

    await userEvent.click(screen.getByRole('radio', { name: /^No catalog/ }));

    expect(onChange).toHaveBeenCalledWith('none');
  });

  it('should only animate the panel after the operator changes the choice', async () => {
    const panel = (container: HTMLElement): Element | null =>
      container.querySelector('.catalogue-mode__panel');
    const { container, rerender } = renderWithProviders(
      <CatalogueModeFieldset value="linked" disabled={false} onChange={vi.fn()}>
        <div>master picker</div>
      </CatalogueModeFieldset>,
    );
    expect(panel(container)).not.toHaveClass('catalogue-mode__panel--enter');

    // A preselection changes the value with no click: it must not move.
    rerender(
      <CatalogueModeFieldset value="none" disabled={false} onChange={vi.fn()}>
        <div>master picker</div>
      </CatalogueModeFieldset>,
    );
    expect(panel(container)).not.toHaveClass('catalogue-mode__panel--enter');

    await userEvent.click(screen.getByRole('radio', { name: /^Linked to a catalog/ }));
    rerender(
      <CatalogueModeFieldset value="linked" disabled={false} onChange={vi.fn()}>
        <div>master picker</div>
      </CatalogueModeFieldset>,
    );
    expect(panel(container)).toHaveClass('catalogue-mode__panel--enter');
  });

  it('should disable both choices when the raw config is not parseable', () => {
    renderWithProviders(
      <CatalogueModeFieldset value="linked" disabled onChange={vi.fn()}>
        <div>master picker</div>
      </CatalogueModeFieldset>,
    );

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
  });
});
