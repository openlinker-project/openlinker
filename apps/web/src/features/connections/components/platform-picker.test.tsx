import { within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlatformPicker } from './platform-picker';
import { renderWithProviders } from '../../../test/test-utils';
import type { OpenLinkerPlugin } from '../../../shared/plugins';

describe('PlatformPicker', () => {
  it('renders a card per platform linking to its guided setup route', () => {
    const view = renderWithProviders(<PlatformPicker />);

    const prestashop = within(view.container).getByRole('link', { name: /PrestaShop/i });
    expect(prestashop).toHaveAttribute('href', '/connections/new/prestashop');

    const allegro = within(view.container).getByRole('link', { name: /Allegro/i });
    expect(allegro).toHaveAttribute('href', '/connections/new/allegro');
  });

  it('exposes an advanced-mode escape hatch', () => {
    const view = renderWithProviders(<PlatformPicker />);
    const advanced = within(view.container).getByRole('link', { name: /advanced mode/i });
    expect(advanced).toHaveAttribute('href', '/connections/new/advanced');
  });

  it('omits plugins without a setupCard', () => {
    const plugins: OpenLinkerPlugin[] = [
      {
        id: 'with-card',
        platformType: 'with-card',
        platform: {
          displayName: 'With Card',
          setupCard: {
            title: 'With Card',
            description: 'Has guided setup.',
            to: '/connections/new/with-card',
            badge: 'Test',
          },
        },
      },
      // No setupCard — must not render.
      {
        id: 'headless',
        platformType: 'headless',
        platform: { displayName: 'Headless' },
      },
    ];
    const view = renderWithProviders(<PlatformPicker />, { plugins });

    expect(
      within(view.container).getByRole('link', { name: /With Card/i }),
    ).toBeInTheDocument();
    expect(
      within(view.container).queryByRole('link', { name: /Headless/i }),
    ).not.toBeInTheDocument();
  });
});
