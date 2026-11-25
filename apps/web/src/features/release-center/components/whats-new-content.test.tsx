import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { WhatsNewContent } from './whats-new-content';

vi.mock('virtual:openlinker-changelog', () => ({
  default: {
    baseline: null,
    // 12 releases, 0.12.0 down to 0.1.0, so three pages of five.
    releases: Array.from({ length: 12 }, (_, i) => ({
      version: `0.${i + 1}.0`,
      date: null,
      groups: [
        { title: 'Features', entries: [{ scope: null, text: `change ${i + 1}`, commits: [] }] },
      ],
    })),
  },
}));
vi.mock('../hooks/use-release-step-rows', () => ({ useReleaseStepRows: () => [] }));
vi.mock('../hooks/use-release-center-access', () => ({
  useReleaseCenterAccess: () => ({ canWriteSteps: false }),
}));
vi.mock('../tour/tour-context', () => ({ useTour: () => ({ start: vi.fn() }) }));

function versions(): string[] {
  return screen
    .getAllByRole('heading', { level: 3 })
    .map((h) => h.textContent ?? '')
    .filter((t) => /^v\d/.test(t));
}

describe('WhatsNewContent pagination', () => {
  it('should show the newest five releases on the first page', () => {
    renderWithProviders(<WhatsNewContent />, { route: '/whats-new' });
    expect(versions()).toEqual(['v0.12.0', 'v0.11.0', 'v0.10.0', 'v0.9.0', 'v0.8.0']);
    expect(screen.getByText(/1.+5/)).toBeInTheDocument();
  });

  it('should open the requested page from the URL', () => {
    renderWithProviders(<WhatsNewContent />, { route: '/whats-new?page=3' });
    expect(versions()).toEqual(['v0.2.0', 'v0.1.0']);
  });

  it('should fall back to a valid page when the page is out of range or invalid', () => {
    renderWithProviders(<WhatsNewContent />, { route: '/whats-new?page=99' });
    expect(versions()).toEqual(['v0.2.0', 'v0.1.0']);
  });

  it('should land a deep link on the page holding the release and mark it', () => {
    renderWithProviders(<WhatsNewContent />, { route: '/whats-new?v=0.4' });
    expect(versions()).toEqual(['v0.7.0', 'v0.6.0', 'v0.5.0', 'v0.4.0', 'v0.3.0']);
    expect(document.getElementById('release-v0.4.0')).toHaveClass('whats-new__card--target');
  });

  it('should move to the next page when Next is pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WhatsNewContent />, { route: '/whats-new' });
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(versions()).toEqual(['v0.7.0', 'v0.6.0', 'v0.5.0', 'v0.4.0', 'v0.3.0']);
  });
});
