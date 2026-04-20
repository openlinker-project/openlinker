import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EmptyValue } from './empty-value';

describe('EmptyValue', () => {
  afterEach(cleanup);

  it('renders an em dash with a default accessible label', () => {
    render(<EmptyValue />);
    const el = screen.getByLabelText('No value');
    expect(el).toHaveTextContent('—');
  });

  it('accepts a custom accessible label', () => {
    render(<EmptyValue label="Not linked" />);
    expect(screen.getByLabelText('Not linked')).toHaveTextContent('—');
  });
});
