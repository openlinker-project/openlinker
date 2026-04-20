import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { KeyValueList } from './key-value-list';

describe('KeyValueList', () => {
  afterEach(cleanup);

  it('renders each item as a dt/dd pair', () => {
    render(
      <KeyValueList
        items={[
          { id: 'name', label: 'Name', value: 'Allegro sandbox' },
          { id: 'status', label: 'Status', value: 'active' },
        ]}
      />,
    );

    expect(screen.getByText('Name').tagName).toBe('DT');
    expect(screen.getByText('Allegro sandbox').tagName).toBe('DD');
    expect(screen.getByText('Status').tagName).toBe('DT');
  });

  it('applies the mono variant to items flagged mono', () => {
    render(
      <KeyValueList items={[{ id: 'id', label: 'ID', value: 'ol_connection_abc', mono: true }]} />,
    );

    expect(screen.getByText('ol_connection_abc')).toHaveClass('key-value-list__value--mono');
  });

  it('renders React node values', () => {
    render(
      <KeyValueList
        items={[
          {
            id: 'badge',
            label: 'Status',
            value: <span data-testid="badge">active</span>,
          },
        ]}
      />,
    );

    expect(screen.getByTestId('badge')).toBeInTheDocument();
  });

  it('merges custom className with internal class', () => {
    const { container } = render(
      <KeyValueList
        className="custom"
        items={[{ id: 'a', label: 'a', value: 'b' }]}
      />,
    );

    expect(container.querySelector('dl')).toHaveClass('key-value-list', 'custom');
  });
});
