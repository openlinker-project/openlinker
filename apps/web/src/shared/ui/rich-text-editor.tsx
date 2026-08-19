/**
 * RichTextEditor
 *
 * The rich-text primitive every description surface uses (ADR-046). Wraps Tiptap
 * for behaviour and accessibility only - all CSS lives in `index.css` against the
 * tokens, and no library stylesheet is imported.
 *
 * ## Its whole surface is derived, not designed
 *
 * The toolbar, the document schema, the tag bold serialises to and the byte cap
 * all come from the destination's declared `DescriptionFormat`. So the editor
 * cannot offer a control whose output the destination would discard: Erli shows
 * an H3 button and Allegro does not because Erli's declaration lists `h3`.
 *
 * ## Value contract: HTML string in, HTML string out
 *
 * A drop-in replacement for the `<Textarea>` each surface used before, which is
 * why swapping a call site is a props change rather than a rewrite. Uncontrolled
 * internally: Tiptap owns the document while focused, and re-seeding it from a
 * prop on every keystroke would fight the caret. The `value` prop is applied when
 * it changes from OUTSIDE (an AI suggestion, a discarded draft, a fetched row) and
 * otherwise left alone.
 *
 * @module apps/web/src/shared/ui
 */
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { Button } from './button';
import {
  buildRichTextExtensions,
  byteLength,
  deriveRichTextProfile,
  type RichTextProfile,
} from './rich-text-profiles';
import type { DescriptionFormat } from './rich-text.types';

export interface RichTextEditorProps {
  /** The destination's declared contract. Everything is derived from it. */
  format: DescriptionFormat;
  /** Current HTML value. */
  value: string;
  onChange: (html: string) => void;
  /** Read-only with a reason (viewer role, inactive connection, narrow viewport). */
  disabled?: boolean;
  placeholder?: string;
  /** Extra actions rendered at the end of the toolbar (e.g. Suggest with AI). */
  toolbarSlot?: ReactNode;
  'aria-label'?: string;
  id?: string;
  className?: string;
}

interface ToolbarButton {
  id: string;
  label: string;
  title: string;
  enabled: (profile: RichTextProfile) => boolean;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const TOOLBAR: ToolbarButton[] = [
  {
    id: 'bold',
    label: 'B',
    title: 'Bold',
    enabled: (p) => p.marks.includes('bold'),
    isActive: (e) => e.isActive('bold'),
    run: (e) => void e.chain().focus().toggleBold().run(),
  },
  {
    id: 'italic',
    // The lossy-conversion note lives on this control because ADR-046 decided
    // italic is renamed to bold on destinations that reject it - the operator
    // should learn that where they press the button, not in a paragraph nobody
    // reads.
    label: 'I',
    title: 'Italic',
    enabled: (p) => p.marks.includes('italic'),
    isActive: (e) => e.isActive('italic'),
    run: (e) => void e.chain().focus().toggleItalic().run(),
  },
  {
    id: 'underline',
    label: 'U',
    title: 'Underline',
    enabled: (p) => p.marks.includes('underline'),
    isActive: (e) => e.isActive('underline'),
    run: (e) => void e.chain().focus().toggleUnderline().run(),
  },
  {
    id: 'strike',
    label: 'S',
    title: 'Strikethrough',
    enabled: (p) => p.marks.includes('strike'),
    isActive: (e) => e.isActive('strike'),
    run: (e) => void e.chain().focus().toggleStrike().run(),
  },
  {
    id: 'bulletList',
    label: '• —',
    title: 'Bullet list',
    enabled: (p) => p.bulletList,
    isActive: (e) => e.isActive('bulletList'),
    run: (e) => void e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    label: '1. —',
    title: 'Numbered list',
    enabled: (p) => p.orderedList,
    isActive: (e) => e.isActive('orderedList'),
    run: (e) => void e.chain().focus().toggleOrderedList().run(),
  },
];

function headingButtons(profile: RichTextProfile): ToolbarButton[] {
  return profile.headingLevels.map((level) => ({
    id: `h${level}`,
    label: `H${level}`,
    title: `Heading ${level}`,
    enabled: () => true,
    isActive: (e: Editor) => e.isActive('heading', { level }),
    run: (e: Editor) => void e.chain().focus().toggleHeading({ level: level as never }).run(),
  }));
}

/**
 * Everything about a format that changes the editor's schema or surface, as one
 * comparable string. Deliberately not `JSON.stringify(format)`: `declared` and
 * `resolvedVia` are diagnostics that must not rebuild the document, and key order
 * in `contentModel` is not meaningful.
 */
function describeFormat(format: DescriptionFormat): string {
  const contentModel =
    format.contentModel === null
      ? '-'
      : Object.keys(format.contentModel)
          .sort()
          .map((parent) => `${parent}>${[...(format.contentModel?.[parent] ?? [])].sort().join('.')}`)
          .join('|');
  const attributes = Object.keys(format.allowedAttributes)
    .sort()
    .map((tag) => `${tag}:${[...format.allowedAttributes[tag]].sort().join('.')}`)
    .join('|');
  const rewrites = format.rewrites
    .map((rewrite) => `${rewrite.from}>${rewrite.action}>${rewrite.to ?? ''}`)
    .sort()
    .join('|');

  return [
    format.shape,
    [...format.allowedTags].sort().join('.'),
    attributes,
    contentModel,
    rewrites,
    String(format.requiresBlockOpener),
    String(format.selfClosingVoids),
    String(format.maxBytes),
  ].join('~');
}

export function RichTextEditor({
  format,
  value,
  onChange,
  disabled = false,
  placeholder = 'Describe the product…',
  toolbarSlot,
  'aria-label': ariaLabel,
  id,
  className = '',
}: RichTextEditorProps): ReactElement {
  // A signature rather than the object identity. The schema genuinely must be
  // rebuilt when the destination's contract changes - and ONLY then. Keying on
  // the `format` prop's identity instead means a caller who writes an inline
  // `format={{ ... }}` (or spreads a fetched one) destroys and recreates the
  // editor on every render: caret lost mid-typing, focus lost, `onChange`
  // re-fired from the fresh mount. Nothing in the prop types would hint at that
  // requirement, so the primitive absorbs it.
  const { profile, formatSignature } = useMemo(
    () => ({ profile: deriveRichTextProfile(format), formatSignature: describeFormat(format) }),
    [format],
  );
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceDraft, setSourceDraft] = useState(value);

  // Tracks what the editor itself last emitted, so an incoming `value` prop can
  // be told apart from our own echo. Without this, every keystroke round-trips
  // through the parent and back and the caret jumps to the end.
  const lastEmitted = useRef(value);

  const editor = useEditor(
    {
      extensions: buildRichTextExtensions(profile, placeholder),
      content: value,
      editable: !disabled,
      onUpdate: ({ editor: instance }) => {
        const html = instance.getHTML();
        // Mounting emits an update whose value is the one the parent just handed
        // us. Echoing it back would mark a form dirty before the operator typed
        // anything - harmless for a value-equality dirty check, but the bulk
        // editors mark dirty straight off `onChange`. `onChange` means the user
        // changed something.
        if (html === lastEmitted.current) return;
        lastEmitted.current = html;
        onChange(html);
      },
      editorProps: {
        attributes: {
          ...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel }),
          ...(id === undefined ? {} : { id }),
          role: 'textbox',
          'aria-multiline': 'true',
        },
      },
    },
    // The schema is rebuilt when the destination's contract changes - a different
    // format is a different document shape - and not on an unrelated re-render.
    [formatSignature],
  );

  useEffect(() => {
    if (editor === null) return;
    if (value === lastEmitted.current) return;
    // An outside change (AI suggestion applied, draft discarded, row refetched).
    editor.commands.setContent(value, { emitUpdate: false });
    lastEmitted.current = value;
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const leaveSourceMode = useCallback(() => {
    // Round-trip through the schema so hand-edited markup is filtered exactly as
    // typed markup is - source mode is an escape hatch, not a bypass.
    editor?.commands.setContent(sourceDraft);
    setSourceMode(false);
  }, [editor, sourceDraft]);

  const enterSourceMode = useCallback(() => {
    setSourceDraft(editor?.getHTML() ?? value);
    setSourceMode(true);
  }, [editor, value]);

  const buttons = useMemo(
    () => [...TOOLBAR.filter((b) => b.enabled(profile)), ...headingButtons(profile)],
    [profile],
  );

  const bytes = byteLength(value);
  const overCap = profile.maxBytes !== null && bytes > profile.maxBytes;
  const nearCap = profile.maxBytes !== null && !overCap && bytes > profile.maxBytes * 0.8;

  return (
    <div className={['rich-text', className].filter(Boolean).join(' ')}>
      <div className="rich-text__toolbar" role="toolbar" aria-label="Formatting">
        {buttons.map((button) => {
          const active = editor !== null && button.isActive(editor);
          return (
            <button
              key={button.id}
              type="button"
              className={['rich-text__tool', active ? 'is-active' : ''].filter(Boolean).join(' ')}
              title={
                button.id === 'italic' && profile.boldTag === 'b'
                  ? 'Italic — this destination has no italic tag, so it publishes as bold'
                  : button.title
              }
              aria-label={button.title}
              aria-pressed={active}
              disabled={disabled || sourceMode || editor === null}
              onClick={() => {
                if (editor !== null) button.run(editor);
              }}
            >
              {button.label}
            </button>
          );
        })}

        {profile.links && (
          <button
            type="button"
            className={['rich-text__tool', editor?.isActive('link') === true ? 'is-active' : '']
              .filter(Boolean)
              .join(' ')}
            title="Add or edit link"
            aria-label="Add or edit link"
            disabled={disabled || sourceMode || editor === null}
            onClick={() => {
              if (editor === null) return;
              const previous = (editor.getAttributes('link').href as string | undefined) ?? 'https://';
              const href = window.prompt('Link target', previous);
              if (href === null) return;
              const chain = editor.chain().focus().extendMarkRange('link');
              if (href === '') chain.unsetLink().run();
              else chain.setLink({ href }).run();
            }}
          >
            ↗
          </button>
        )}

        <div className="rich-text__toolbar-end">
          {toolbarSlot}
          <Button
            type="button"
            tone="ghost"
            className="button--xs rich-text__source-toggle"
            aria-pressed={sourceMode}
            disabled={disabled}
            onClick={() => {
              if (sourceMode) leaveSourceMode();
              else enterSourceMode();
            }}
          >
            {sourceMode ? 'Rich text' : 'HTML'}
          </Button>
        </div>
      </div>

      {sourceMode ? (
        <textarea
          className="rich-text__source"
          spellCheck={false}
          aria-label={ariaLabel === undefined ? 'HTML source' : `${ariaLabel} (HTML source)`}
          value={sourceDraft}
          readOnly={disabled}
          onChange={(event) => setSourceDraft(event.target.value)}
          onBlur={leaveSourceMode}
        />
      ) : (
        <EditorContent editor={editor} className="rich-text__surface" />
      )}

      <div className="rich-text__footer">
        {!format.declared && (
          <span className="rich-text__undeclared">
            This destination has not declared its description format — showing a safe subset.
          </span>
        )}
        {profile.maxBytes !== null && (
          <span
            className={[
              'rich-text__bytes',
              overCap ? 'is-over' : '',
              nearCap ? 'is-near' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {bytes.toLocaleString()} / {profile.maxBytes.toLocaleString()} bytes
            {overCap ? ' — over the destination limit' : ''}
          </span>
        )}
      </div>
    </div>
  );
}
