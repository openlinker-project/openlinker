import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '../../../shared/auth/session.types';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import { useTour } from './tour-context';
import { TourProvider } from './tour-provider';

const admin: SessionUser = {
  id: 'u1',
  username: 'u',
  email: 'u@example.com',
  role: 'admin',
  permissions: ['fulfillment:read', 'connections:write'],
  analyticsConsent: true,
};

function Starter(): ReactElement {
  const tour = useTour();
  return (
    <>
      <button
        onClick={() =>
          tour.start([
            { stepId: 'shipping-routing', connectionId: 'c1', importance: 'required' },
            { stepId: 'packing-owner', connectionId: 'c1', importance: 'optional' },
          ])
        }
      >
        start
      </button>
      <button
        onClick={() =>
          tour.start([
            { stepId: 'packing-owner', connectionId: 'c1', importance: 'required' },
            { stepId: 'shipping-routing', connectionId: 'c1', importance: 'optional' },
          ])
        }
      >
        start-missing
      </button>
      <div data-tour="label-master">target</div>
    </>
  );
}

function setup(user: SessionUser): void {
  const getState = vi.fn().mockResolvedValue({ enabled: true, cursor: null, user: [], installation: [] });
  renderWithProviders(
    <TourProvider>
      <Starter />
    </TourProvider>,
    {
      apiClient: createMockApiClient({ releaseState: { getState } }),
      sessionAdapter: createAuthenticatedSessionAdapter(user),
    }
  );
}

describe('TourCard', () => {
  it('should block Next on a required step with an accessible reason, and focus the card', async () => {
    setup(admin);
    fireEvent.click(screen.getByText('start'));
    const region = await screen.findByRole('region', { name: 'Guided tour' });
    await waitFor(() => expect(region).toHaveFocus());
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(next.getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.click(next);
    expect(screen.getByText(/^Step 1 of 2$/)).toBeInTheDocument();
  });

  it('should not block a viewer and should show the administrator chip', async () => {
    setup({ ...admin, role: 'viewer', permissions: ['fulfillment:read'] });
    fireEvent.click(screen.getByText('start'));
    await screen.findByRole('region', { name: 'Guided tour' });
    expect(screen.getByText('Needs an administrator')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/^Step 2 of 2$/)).toBeInTheDocument();
  });

  it('should close the tour on Escape and return focus to the trigger', async () => {
    setup(admin);
    const trigger = screen.getByText('start');
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole('region', { name: 'Guided tour' });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Guided tour' })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('should offer Skip instead of Next when the target is missing, even on a required step', async () => {
    setup(admin);
    fireEvent.click(screen.getByText('start-missing'));
    const skip = await screen.findByRole('button', { name: 'Skip this step' }, { timeout: 4000 });
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I will do it later' })).toBeInTheDocument();
    fireEvent.click(skip);
    expect(await screen.findByText(/^Step 2 of 2$/)).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 2: skipped')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 2: current')).toBeInTheDocument();
  });
});
