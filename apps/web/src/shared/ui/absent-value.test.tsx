import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AbsentValue } from './absent-value';

describe('AbsentValue', () => {
  afterEach(cleanup);

  it('should render a visible dash when the value is absent', () => {
    const { container } = render(<AbsentValue label="No rate read yet" />);
    expect(container.textContent).toContain('—');
  });

  it('should carry the wording visually hidden, not only as an aria-label', () => {
    // aria-label on a bare <span> is prohibited and commonly dropped, which is
    // why absence-versus-zero cannot rely on it (#2253).
    const { container } = render(<AbsentValue label="No rate read yet" />);
    const hidden = container.querySelector('.sr-only');
    expect(hidden).not.toBeNull();
    expect(hidden).toHaveTextContent('No rate read yet');
  });

  it('should still expose the label to the accessibility tree', () => {
    render(<AbsentValue label="Price not reported by the channel" />);
    expect(screen.getByLabelText('Price not reported by the channel')).toHaveTextContent('—');
  });
});
