/**
 * renderRich - unit tests
 *
 * @module shared/i18n
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderRich } from './render-rich';

afterEach(() => cleanup());

describe('renderRich', () => {
  it('should render a tagged chunk through its part and keep the rest as text', () => {
    render(
      <p data-testid="out">
        {renderRich('Read the <link>guide</link> before <b>saving</b>.', {
          link: (chunk) => <a href="/guide">{chunk}</a>,
          b: (chunk) => <strong>{chunk}</strong>,
        })}
      </p>,
    );
    expect(screen.getByTestId('out')).toHaveTextContent('Read the guide before saving.');
    expect(screen.getByRole('link', { name: 'guide' })).toHaveAttribute('href', '/guide');
    expect(screen.getByText('saving').tagName).toBe('STRONG');
  });

  it('should render an unknown tag as plain text, never as markup', () => {
    render(<p data-testid="out">{renderRich('A <script>x</script> b', {})}</p>);
    expect(screen.getByTestId('out')).toHaveTextContent('A x b');
    expect(screen.getByTestId('out').querySelector('script')).toBeNull();
  });
});
