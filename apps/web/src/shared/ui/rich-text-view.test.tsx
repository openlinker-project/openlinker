/**
 * @vitest-environment jsdom
 *
 * RichTextView tests
 *
 * The security assertions are the point: this is the only sanctioned
 * `dangerouslySetInnerHTML` in the app, and it must strip `style` even though
 * storage deliberately keeps it (ADR-046 / #2198).
 *
 * ## Why this file overrides the environment to jsdom
 *
 * The app runs `vitest` on happy-dom, and DOMPurify does NOT behave correctly
 * there - under happy-dom it returned empty output for a `<ul>`, left a
 * `<script>` element standing and dropped an `<a href>`. That matches DOMPurify's
 * own README, which states happy-dom "is not considered safe at this point".
 *
 * Testing a sanitizer in an environment where it demonstrably misbehaves would
 * produce assurance about nothing, in either direction, so this suite runs on
 * jsdom - which is also much closer to the real browser these assertions are
 * about.
 *
 * @module apps/web/src/shared/ui
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RichTextView } from './rich-text-view';

describe('RichTextView', () => {
  afterEach(cleanup);

  it('should render stored HTML as markup rather than printing the tags', () => {
    // The defect this primitive exists to fix: every surface used to interpolate
    // the value into a <p>, so React escaped it and the operator saw angle
    // brackets.
    render(<RichTextView html="<ul><li>Puch 90/10</li></ul>" />);

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('Puch 90/10');
  });

  it('should strip a script element', () => {
    const { container } = render(<RichTextView html='<p>ok</p><script>alert(1)</script>' />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('ok');
  });

  it('should strip an event-handler attribute', () => {
    const { container } = render(<RichTextView html='<img src="x" onerror="alert(1)">' />);

    expect(container.innerHTML).not.toContain('onerror');
  });

  it('should strip style, which storage deliberately keeps', () => {
    // The asymmetry is intentional: the inbound boundary keeps `style` so it does
    // not rewrite the operator's catalogue, and render drops it because arbitrary
    // CSS in the admin page is a UI-redressing vector.
    const { container } = render(
      <RichTextView html='<p style="position:fixed;z-index:9999;inset:0">overlay</p>' />,
    );

    expect(container.innerHTML).not.toContain('style');
    expect(container.textContent).toContain('overlay');
  });

  it('should strip class, which could collide with a real component class', () => {
    const { container } = render(<RichTextView html='<p class="page-header">x</p>' />);

    expect(container.innerHTML).not.toContain('page-header');
  });

  it('should strip target so a description link cannot reach the opener', () => {
    const { container } = render(
      <RichTextView html='<a href="https://x.example" target="_blank">t</a>' />,
    );

    expect(container.innerHTML).not.toContain('target');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://x.example');
  });

  it('should drop a javascript: href', () => {
    const { container } = render(<RichTextView html='<a href="javascript:alert(1)">t</a>' />);

    expect(container.innerHTML).not.toContain('javascript');
  });

  it('should keep a table, which a shop description really contains', () => {
    render(<RichTextView html="<table><tbody><tr><td>Waga</td></tr></tbody></table>" />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('cell')).toHaveTextContent('Waga');
  });

  it('should render the empty state for null', () => {
    render(<RichTextView html={null} />);
    expect(screen.getByText('No description')).toBeInTheDocument();
  });

  it('should render the empty state for whitespace-only HTML', () => {
    render(<RichTextView html="   " />);
    expect(screen.getByText('No description')).toBeInTheDocument();
  });

  it('should use a caller-supplied empty label', () => {
    render(<RichTextView html="" emptyLabel="Nothing synced from the source" />);
    expect(screen.getByText('Nothing synced from the source')).toBeInTheDocument();
  });

  it('should merge a custom className without dropping its own', () => {
    const { container } = render(<RichTextView html="<p>x</p>" className="detail-block" />);

    const root = container.firstElementChild;
    expect(root).toHaveClass('rich-text-view');
    expect(root).toHaveClass('detail-block');
  });
});
