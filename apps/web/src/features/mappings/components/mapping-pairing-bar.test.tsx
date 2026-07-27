/**
 * MappingPairingBar tests (#1784 follow-up S19)
 *
 * Focused component coverage for the pairing route strip. Rendered through
 * `renderWithProviders` so `usePlatforms()` resolves labels from the plugin
 * registry.
 *
 * @module apps/web/src/features/mappings/components
 */

import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { MappingPairingBar } from './mapping-pairing-bar';
import type { Connection } from '../../connections';
import type { MappingPairing } from '../hooks/use-mapping-pairing.types';

const ALLEGRO: Connection = {
  ...sampleConnection,
  id: 'alg_1',
  name: 'Main Allegro',
  platformType: 'allegro',
};

describe('MappingPairingBar', () => {
  afterEach(cleanup);

  it('renders "Not linked" when a ready/unsupported source has a null destination', () => {
    const pairing: MappingPairing = {
      status: 'unsupported',
      source: { ...sampleConnection, id: 'woo_1', name: 'US Woo', platformType: 'woocommerce' },
      destination: null,
    };
    renderWithProviders(<MappingPairingBar pairing={pairing} />);

    expect(screen.getByText('Not linked')).toBeInTheDocument();
    expect(screen.getByText('US Woo')).toBeInTheDocument();
  });

  it('only invokes onPickSource after an explicit Configure click (#1784 I5)', async () => {
    const user = userEvent.setup();
    const onPickSource = vi.fn();
    const erli: Connection = {
      ...sampleConnection,
      id: 'erli_1',
      name: 'Erli Store',
      platformType: 'erli',
    };
    const pairing: MappingPairing = {
      status: 'pick-source',
      master: { ...sampleConnection, id: 'ps_1', name: 'Main PrestaShop Store' },
      candidates: [ALLEGRO, erli],
    };
    renderWithProviders(<MappingPairingBar pairing={pairing} onPickSource={onPickSource} />);

    // Selecting a value alone must NOT navigate (no keyboard trap).
    await user.selectOptions(
      screen.getByRole('combobox', { name: /Choose marketplace to configure/i }),
      'alg_1',
    );
    expect(onPickSource).not.toHaveBeenCalled();

    // Only the explicit Configure click fires the callback.
    await user.click(screen.getByRole('button', { name: 'Configure' }));
    expect(onPickSource).toHaveBeenCalledWith('alg_1');
  });
});
