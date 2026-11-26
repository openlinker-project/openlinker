/**
 * CapabilityName tests
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { CORE_CAPABILITY_VALUES } from '../api/connections.types';
import { CapabilityName } from './capability-name';

describe('CapabilityName', () => {
  afterEach(cleanup);

  it('should show the plain label first and the code name as secondary text', () => {
    renderWithProviders(<CapabilityName capability="ProductMaster" />);
    expect(screen.getByText('Product catalog')).toBeInTheDocument();
    expect(screen.getByText('ProductMaster')).toHaveClass('capability-list__code');
  });

  it.each(CORE_CAPABILITY_VALUES)('should have a plain label for %s', (capability) => {
    renderWithProviders(<CapabilityName capability={capability} />);
    const label = document.querySelector('.capability-list__name');
    expect(label?.textContent).toBeTruthy();
    expect(label?.textContent).not.toBe(capability);
  });
});
