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
    expect(screen.queryByText('No catalog')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Linked/ })).toBeChecked();
  });

  it('should replace the picker with the notice while none', () => {
    renderWithProviders(
      <CatalogueModeFieldset value="none" disabled={false} onChange={vi.fn()}>
        <div>master picker</div>
      </CatalogueModeFieldset>,
    );

    expect(screen.queryByText('master picker')).not.toBeInTheDocument();
    expect(screen.getByText('No catalog')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^None/ })).toBeChecked();
  });

  it('should report the chosen mode', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <CatalogueModeFieldset value="linked" disabled={false} onChange={onChange}>
        <div>master picker</div>
      </CatalogueModeFieldset>,
    );

    await userEvent.click(screen.getByRole('radio', { name: /^None/ }));

    expect(onChange).toHaveBeenCalledWith('none');
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
