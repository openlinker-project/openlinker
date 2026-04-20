import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RawPayloadPanel } from './raw-payload-panel';

describe('RawPayloadPanel', () => {
  afterEach(cleanup);

  it('is collapsed by default and expands on click', () => {
    render(<RawPayloadPanel payload={{ foo: 'bar' }} />);

    expect(screen.queryByLabelText('Payload content')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByLabelText('Payload content')).toHaveTextContent('"foo": "bar"');
  });

  it('can start expanded via defaultOpen', () => {
    render(<RawPayloadPanel payload={{ a: 1 }} defaultOpen />);
    expect(screen.getByLabelText('Payload content')).toHaveTextContent('"a": 1');
  });

  it('renders string payloads verbatim', () => {
    render(<RawPayloadPanel payload={'plain error text'} defaultOpen />);
    expect(screen.getByLabelText('Payload content')).toHaveTextContent('plain error text');
  });

  it('renders an empty body for null payloads', () => {
    render(<RawPayloadPanel payload={null} defaultOpen />);
    expect(screen.getByLabelText('Payload content').textContent).toBe('');
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
