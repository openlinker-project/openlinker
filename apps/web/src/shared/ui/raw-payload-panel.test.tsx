import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RawPayloadPanel } from './raw-payload-panel';

describe('RawPayloadPanel', () => {
  afterEach(cleanup);

  it('is collapsed by default and expands on click', () => {
    render(<RawPayloadPanel payload={{ foo: 'bar' }} />);

    const body = screen.getByLabelText('Payload content');
    expect(body).toHaveAttribute('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(body).not.toHaveAttribute('hidden');
    expect(body).toHaveTextContent('"foo": "bar"');
  });

  it('toggles aria-expanded on the disclosure button', () => {
    render(<RawPayloadPanel payload={{ a: 1 }} />);
    const button = screen.getByRole('button', { name: 'Expand' });

    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('wires aria-controls to the body id', () => {
    render(<RawPayloadPanel payload={{ a: 1 }} />);
    const button = screen.getByRole('button', { name: 'Expand' });
    const controls = button.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(screen.getByLabelText('Payload content')).toHaveAttribute('id', controls!);
  });

  it('can start expanded via defaultOpen', () => {
    render(<RawPayloadPanel payload={{ a: 1 }} defaultOpen />);
    const body = screen.getByLabelText('Payload content');
    expect(body).not.toHaveAttribute('hidden');
    expect(body).toHaveTextContent('"a": 1');
  });

  it('renders string payloads verbatim without syntax tinting', () => {
    render(<RawPayloadPanel payload={'plain error text'} defaultOpen />);
    const body = screen.getByLabelText('Payload content');
    expect(body).toHaveTextContent('plain error text');
    expect(body.querySelector('.raw-payload__token-key')).toBeNull();
  });

  it('applies syntax tinting for JSON payloads', () => {
    render(<RawPayloadPanel payload={{ count: 42, label: 'ok', flag: null }} defaultOpen />);
    const body = screen.getByLabelText('Payload content');

    expect(body.querySelector('.raw-payload__token-key')).not.toBeNull();
    expect(body.querySelector('.raw-payload__token-number')).not.toBeNull();
    expect(body.querySelector('.raw-payload__token-literal')).not.toBeNull();
  });

  it('copies the formatted payload via the copy button', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<RawPayloadPanel payload={{ a: 1 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy payload' }));

    expect(writeText).toHaveBeenCalledWith('{\n  "a": 1\n}');
  });

  it('renders a title and description', () => {
    render(<RawPayloadPanel payload={{}} title="Config" description="Current adapter config" />);
    expect(screen.getByText('Config')).toBeInTheDocument();
    expect(screen.getByText('Current adapter config')).toBeInTheDocument();
  });
});
