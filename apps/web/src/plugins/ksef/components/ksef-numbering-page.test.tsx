/**
 * KsefNumberingPage tests
 *
 * Covers the tab-switch demo instrumentation (#1789). The page itself is a
 * thin `Tabs` shell around `KsefNumberingSeriesTab` / `KsefNumberingAuditTab`;
 * those own their own coverage.
 *
 * @module plugins/ksef/components
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { KsefNumberingPage } from './ksef-numbering-page';

const captureDemoEvent = vi.fn();
vi.mock('../../../features/demo', () => ({
  captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args),
}));

describe('KsefNumberingPage', () => {
  beforeEach(() => {
    captureDemoEvent.mockClear();
  });
  afterEach(cleanup);

  it('renders the Series tab by default', async () => {
    renderWithProviders(<KsefNumberingPage />);
    expect(await screen.findByText('No numbering series yet')).toBeInTheDocument();
  });

  it('captures demo_ksef_numbering_tab_switched when switching to the audit tab (#1789)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<KsefNumberingPage />);

    await screen.findByText('No numbering series yet');
    await user.click(screen.getByRole('tab', { name: 'Number audit' }));

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_ksef_numbering_tab_switched', {
      tab: 'audit',
    });
  });
});
