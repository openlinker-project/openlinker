/**
 * @vitest-environment jsdom
 *
 * RichTextEditor tests
 *
 * Runs on jsdom rather than the app default: Tiptap is ProseMirror, which needs
 * Range, Selection and `getClientRects` to mount an editable surface at all, and
 * happy-dom covers those only partly.
 *
 * The assertions concentrate on the derived surface - which controls exist for a
 * given declaration - because that is the contract ADR-046 buys. Caret-level
 * editing behaviour belongs to ProseMirror and is not re-tested here.
 *
 * @module apps/web/src/shared/ui
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RichTextEditor } from './rich-text-editor';
import type { DescriptionFormat } from './rich-text.types';

function format(overrides: Partial<DescriptionFormat> = {}): DescriptionFormat {
  return {
    shape: 'html',
    allowedTags: ['h1', 'h2', 'p', 'ul', 'ol', 'li', 'b'],
    allowedAttributes: {},
    contentModel: { root: ['h1', 'h2', 'p', 'ul', 'ol'], p: ['b'], li: ['b', 'p'], h1: [], h2: [] },
    rewrites: [{ from: 'strong', action: 'rename', to: 'b' }],
    requiresBlockOpener: true,
    selfClosingVoids: false,
    maxBytes: 40000,
    declared: true,
    resolvedVia: 'OfferManager',
    ...overrides,
  };
}

describe('RichTextEditor', () => {
  afterEach(cleanup);

  it('should render only the controls the destination declares', () => {
    render(<RichTextEditor format={format()} value="<p>x</p>" onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Heading 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Heading 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bullet list' })).toBeInTheDocument();

    // Not declared, so not offered - the operator cannot author what the
    // destination would discard.
    expect(screen.queryByRole('button', { name: 'Italic' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Underline' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add or edit link' })).toBeNull();
  });

  it('should render an H3 control when the destination allows h3', () => {
    render(
      <RichTextEditor
        format={format({ allowedTags: ['h1', 'h2', 'h3', 'p'] })}
        value="<p>x</p>"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Heading 3' })).toBeInTheDocument();
  });

  it('should render the link control when an anchor is allowed', () => {
    render(
      <RichTextEditor
        format={format({ allowedTags: ['p', 'a'], allowedAttributes: { a: ['href'] } })}
        value="<p>x</p>"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add or edit link' })).toBeInTheDocument();
  });

  it('should warn on the italic control when the destination rewrites italic to bold', () => {
    // ADR-046 subordinate decision 2. The old condition was `boldTag === 'b'`,
    // which meant the note only appeared for a destination that HAS an italic
    // tag - i.e. exactly where the statement is false - and never for Allegro,
    // whose declaration has no `i` and rewrites it to `b`.
    render(
      <RichTextEditor
        format={format({
          allowedTags: ['p', 'b'],
          rewrites: [{ from: 'i', action: 'rename', to: 'b' }],
        })}
        value="<p>x</p>"
        onChange={vi.fn()}
      />,
    );

    const italic = screen.getByRole('button', { name: 'Italic' });
    expect(italic).toBeInTheDocument();
    expect(italic.getAttribute('title')).toContain('publishes as bold');
  });

  it('should render the byte counter against the declared cap', () => {
    render(<RichTextEditor format={format()} value="<p>abc</p>" onChange={vi.fn()} />);

    expect(screen.getByText(/40,000 bytes/)).toBeInTheDocument();
  });

  it('should omit the byte counter when the destination declares no cap', () => {
    render(<RichTextEditor format={format({ maxBytes: null })} value="<p>x</p>" onChange={vi.fn()} />);

    expect(screen.queryByText(/bytes/)).toBeNull();
  });

  it('should flag a value over the declared cap', () => {
    render(<RichTextEditor format={format({ maxBytes: 4 })} value="<p>too long</p>" onChange={vi.fn()} />);

    expect(screen.getByText(/over the destination limit/)).toBeInTheDocument();
  });

  it('should say so when the destination declared no format', () => {
    // Otherwise the conservative subset reads as authoritative, which is what
    // ADR-046 subordinate decision 1 exists to prevent.
    render(<RichTextEditor format={format({ declared: false })} value="<p>x</p>" onChange={vi.fn()} />);

    expect(screen.getByText(/has not declared its description format/)).toBeInTheDocument();
  });

  it('should not claim a fallback when the format is declared', () => {
    render(<RichTextEditor format={format()} value="<p>x</p>" onChange={vi.fn()} />);

    expect(screen.queryByText(/has not declared/)).toBeNull();
  });

  it('should disable every control when disabled', () => {
    render(<RichTextEditor format={format()} value="<p>x</p>" onChange={vi.fn()} disabled />);

    expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled();
  });

  it('should expose an HTML source toggle', () => {
    render(<RichTextEditor format={format()} value="<p>x</p>" onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'HTML' })).toBeInTheDocument();
  });

  it('should render a caller-supplied toolbar slot', () => {
    render(
      <RichTextEditor
        format={format()}
        value="<p>x</p>"
        onChange={vi.fn()}
        toolbarSlot={<button type="button">Suggest with AI</button>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Suggest with AI' })).toBeInTheDocument();
  });

  it('should not fire onChange on mount, so a form is not dirty before the operator types', () => {
    // Mounting emits a Tiptap update whose value is the one the parent just
    // handed us. Echoing it would enable Save with no user edit in the bulk
    // editors, which mark dirty straight off onChange.
    const onChange = vi.fn();
    render(<RichTextEditor format={format()} value="<p>seeded</p>" onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should not report normalization of the seeded value as an edit', async () => {
    // The bug this pins: seeding plain text into a format that requires a block
    // opener serializes as `<p>…</p>`, which differs from the prop. Emitting that
    // made every freshly opened bulk variant panel read "Description overridden"
    // - a caller writing `value === base ? undefined : value` recorded an
    // override the operator never made. String equality cannot catch it; the
    // guard is textual.
    const onChange = vi.fn();
    render(<RichTextEditor format={format()} value="A hoodie" onChange={onChange} />);

    // Give any mount-time transaction a chance to land.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should not report normalization of a newly applied outside value as an edit', async () => {
    // An AI suggestion or a refetched row arrives as plain text too, and gets the
    // same restatement allowance.
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextEditor format={format()} value="<p>first</p>" onChange={onChange} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    onChange.mockClear();

    rerender(<RichTextEditor format={format()} value="Generated copy" onChange={onChange} />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should keep the same editor instance when the format prop is a fresh object', () => {
    // Keying the schema rebuild on the format's object IDENTITY meant a caller
    // spreading a fetched format, or writing an inline literal, destroyed and
    // recreated the editor on every render - caret and focus lost mid-typing.
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextEditor format={{ ...format() }} value="<p>a</p>" onChange={onChange} />,
    );
    const first = document.querySelector('.ProseMirror');

    rerender(<RichTextEditor format={{ ...format() }} value="<p>a</p>" onChange={onChange} />);

    expect(document.querySelector('.ProseMirror')).toBe(first);
  });

  it('should rebuild the editor when the destination contract actually changes', () => {
    // The other half of the same rule: a different contract IS a different
    // document shape, so it must rebuild.
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextEditor format={format()} value="<p>a</p>" onChange={onChange} />,
    );
    expect(screen.queryByRole('button', { name: 'Heading 3' })).toBeNull();

    rerender(
      <RichTextEditor
        format={format({ allowedTags: ['h1', 'h2', 'h3', 'p', 'b'] })}
        value="<p>a</p>"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('button', { name: 'Heading 3' })).toBeInTheDocument();
  });

  it('should filter hand-edited HTML through the schema when leaving source mode', () => {
    // Source mode is an escape hatch, not a bypass: what comes back is what the
    // destination's schema accepts, and the parent is told.
    const onChange = vi.fn();
    render(<RichTextEditor format={format()} value="<p>a</p>" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'HTML' }));
    fireEvent.change(screen.getByRole('textbox', { name: /HTML source/ }), {
      target: { value: '<p>b <span style="color:red">c</span></p>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rich text' }));

    expect(onChange).toHaveBeenCalledWith('<p>b c</p>');
  });

  it('should label the editing surface for assistive tech', () => {
    render(
      <RichTextEditor
        format={format()}
        value="<p>x</p>"
        onChange={vi.fn()}
        aria-label="Master description"
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Master description' })).toBeInTheDocument();
  });


  it('should not claim italic publishes as bold when the destination has an italic tag', () => {
    render(
      <RichTextEditor
        format={format({ allowedTags: ['p', 'b', 'i'] })}
        value="<p>x</p>"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Italic' }).getAttribute('title')).not.toContain(
      'publishes as bold',
    );
  });

  it('should render a disabled placeholder until the destination format arrives', () => {
    // The frontend holds no format of its own, so there is nothing to author
    // against before the read resolves (ADR-046 subordinate decision 1).
    render(<RichTextEditor format={null} value="<p>x</p>" onChange={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Bold' })).not.toBeInTheDocument();
    expect(screen.getByText(/Loading the destination/)).toBeInTheDocument();
  });
});
