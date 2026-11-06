import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidePanel } from './side-panel';

function stubViewport(phone: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: phone && query.includes('max-width: 640px'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function Harness({ initiallyOpen = true }: { initiallyOpen?: boolean }): ReactElement {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open panel
      </button>
      <SidePanel
        open={open}
        onOpenChange={setOpen}
        title="Order 1042"
        kicker="Allegro"
        meta={<span>Paid</span>}
        headerAside={<span>249.00 PLN</span>}
        description="Order summary"
        footer={<button type="button">Open order</button>}
      >
        <p>Two items</p>
      </SidePanel>
    </>
  );
}

describe('SidePanel', () => {
  beforeEach(() => stubViewport(false));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.body.classList.remove('side-panel-sheet-open');
  });

  it('renders the header slots, body and footer as a labelled dialog', () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: 'Order 1042' });
    expect(dialog).toHaveAccessibleDescription('Order summary');
    expect(screen.getByText('Allegro')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('249.00 PLN')).toBeInTheDocument();
    expect(screen.getByText('Two items')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open order' })).toBeInTheDocument();
  });

  it('floats on desktop and shows no grab handle', () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('side-panel--floating');
    expect(dialog.querySelector('.side-panel__handle')).toBeNull();
  });

  it('closes from the close button with its copy label', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('becomes a bottom sheet on a phone and scales the shell back while open', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('side-panel--sheet');
    expect(dialog.querySelector('.side-panel__handle')).not.toBeNull();
    expect(document.body).toHaveClass('side-panel-sheet-open');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.body).not.toHaveClass('side-panel-sheet-open'));
  });

  it('renders nothing while closed', () => {
    render(<Harness initiallyOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
