/**
 * GiftsGuide tests (#3935)
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { GiftsGuide } from './gifts-guide';

afterEach(cleanup);

describe('GiftsGuide', () => {
  it('should open the shared guide drawer with the variant words from the button', () => {
    renderWithProviders(<GiftsGuide variant="list" />);

    const drawer = document.querySelector('.pm-guide') as HTMLElement;
    expect(drawer).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByTestId('gifts-guide-open'));

    expect(drawer).toHaveAttribute('data-open', 'true');
    expect(drawer).toHaveTextContent('Gifts and bundles in orders');
    expect(drawer).toHaveTextContent('Row marks');
  });
});
