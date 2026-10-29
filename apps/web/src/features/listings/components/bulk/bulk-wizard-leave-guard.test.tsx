/**
 * BulkWizardLeaveGuard tests (#3851)
 *
 * Rendered inside a real data router (`createMemoryRouter`), because the
 * in-app half is React Router's `useBlocker`, which only exists there. Pins the
 * three states the issue names: edits held -> ask, nothing edited -> no prompt,
 * submitted -> no prompt.
 */
import { useRef, type ReactElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { BulkWizardLeaveGuard } from './bulk-wizard-leave-guard';

afterEach(cleanup);

function WizardStandIn({ active, released }: { active: boolean; released: boolean }): ReactElement {
  const releasedRef = useRef(released);
  return (
    <>
      <h1>Wizard</h1>
      <Link to="/elsewhere">Go elsewhere</Link>
      <BulkWizardLeaveGuard active={active} released={releasedRef} />
    </>
  );
}

function renderGuard(active: boolean, released = false): void {
  const router = createMemoryRouter(
    [
      { path: '/wizard', element: <WizardStandIn active={active} released={released} /> },
      { path: '/elsewhere', element: <h1>Elsewhere</h1> },
    ],
    { initialEntries: ['/wizard'] },
  );
  render(<RouterProvider router={router} />);
}

function fireBeforeUnload(): Event {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe('BulkWizardLeaveGuard', () => {
  it('should ask before an in-app navigation when the wizard holds edits', async () => {
    renderGuard(true);

    fireEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }));

    expect(await screen.findByRole('dialog', { name: 'Leave this batch?' })).toBeInTheDocument();
    // The modal hides the page behind it from the accessibility tree.
    expect(screen.getByRole('heading', { name: 'Wizard', hidden: true })).toBeInTheDocument();
  });

  it('should stay on the wizard when the operator keeps editing', async () => {
    renderGuard(true);
    fireEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));

    expect(screen.getByRole('heading', { name: 'Wizard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Elsewhere' })).not.toBeInTheDocument();
  });

  it('should navigate when the operator discards the edits', async () => {
    renderGuard(true);
    fireEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Discard and leave' }));

    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeInTheDocument();
  });

  it('should prevent an unload when the wizard holds edits', () => {
    renderGuard(true);

    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it('should not ask when nothing was edited', async () => {
    renderGuard(false);

    fireEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }));

    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeInTheDocument();
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it('should not ask once the batch was submitted', async () => {
    renderGuard(true, true);

    expect(fireBeforeUnload().defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }));

    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Leave this batch?' })).not.toBeInTheDocument();
  });
});
