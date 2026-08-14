import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyableId } from './copyable-id';

const ID = 'aa966882-0d21-4e2f-9d5a-71c4a5f14cfb';

/**
 * Keeps the real Navigator prototype (happy-dom internals and React's scheduler
 * both read off it) while overriding only `clipboard`, and stays restorable via
 * `vi.unstubAllGlobals()` — unlike a bare `Object.defineProperty(navigator, …)`.
 */
function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    'navigator',
    Object.create(navigator, { clipboard: { value: { writeText }, configurable: true } }),
  );
  return writeText;
}

describe('CopyableId', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the full id when no label is given', () => {
    render(<CopyableId id={ID} />);
    expect(screen.getByText(ID)).toBeInTheDocument();
  });

  it('renders the shorter label while still copying the full id', () => {
    const writeText = stubClipboard();
    render(<CopyableId id={ID} label="aa966882…4cfb" />);

    expect(screen.getByText('aa966882…4cfb')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));

    expect(writeText).toHaveBeenCalledWith(ID);
  });

  it('names the copy button after the raw id by default', () => {
    render(<CopyableId id={ID} />);
    expect(screen.getByRole('button', { name: `Copy ${ID}` })).toBeInTheDocument();
  });

  it('uses copyLabel and copiedLabel for the accessible name when supplied', async () => {
    stubClipboard();
    render(
      <CopyableId
        id={ID}
        copyLabel="Copy connection ID for Erli Demo"
        copiedLabel="Copied connection ID for Erli Demo"
      />,
    );

    const button = screen.getByRole('button', { name: 'Copy connection ID for Erli Demo' });
    fireEvent.click(button);

    expect(
      await screen.findByRole('button', { name: 'Copied connection ID for Erli Demo' }),
    ).toBeInTheDocument();
  });

  it('merges a custom className with the internal classes', () => {
    const { container } = render(<CopyableId id={ID} className="custom" />);
    expect(container.firstElementChild).toHaveClass('copyable-id', 'custom');
  });

  it('forwards the ref to the root span', () => {
    const ref = { current: null as HTMLSpanElement | null };
    render(<CopyableId id={ID} ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
  });
});
