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
  /**
   * The destination's declared contract. Everything is derived from it.
   *
   * `null` means it has not arrived yet, and the editor then renders a disabled
   * placeholder rather than authoring against a guess. The frontend deliberately
   * holds NO default of its own (ADR-046 subordinate decision 1): two call sites
   * used to keep a local "conservative" literal, which was Allegro's grammar
   * transcribed into `apps/web` - the alternative that ADR rejected by name -
   * and it announced "this destination has not declared its format" for the
   * duration of every fetch, about destinations that had.
   */
  format: DescriptionFormat | null;
  /** Current HTML value. */
  value: string;
  onChange: (html: string) => void;
  /** Read-only with a reason (viewer role, inactive connection, narrow viewport). */
  disabled?: boolean;
  /** Marks the control invalid and points at its error text, like `Input`. */
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
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

/** Text content of an HTML fragment, for telling normalization from an edit. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A shape for the pre-arrival render only.
 *
 * Never used to author anything: when `format` is null the component returns the
 * disabled placeholder before any editor is mounted. It exists so the hooks below
 * keep a stable shape rather than being called conditionally.
 */
const PLACEHOLDER_FORMAT: DescriptionFormat = {
  shape: 'html',
  allowedTags: [],
  allowedAttributes: {},
  contentModel: null,
  rewrites: [],
  requiresBlockOpener: false,
  selfClosingVoids: false,
  maxBytes: null,
  declared: false,
  resolvedVia: null,
};

export function RichTextEditor({
  format,
  value,
  onChange,
  disabled = false,
  placeholder = 'Describe the product…',
  toolbarSlot,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
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
    () => ({
      // A null format is only ever the pre-arrival state; the placeholder below
      // renders instead of an editor, so the profile is never read in that case.
      profile: deriveRichTextProfile(format ?? PLACEHOLDER_FORMAT),
      formatSignature: describeFormat(format ?? PLACEHOLDER_FORMAT),
    }),
    [format],
  );
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceDraft, setSourceDraft] = useState(value ?? '');

  /**
   * Two refs, because the prop and the editor's serialization are NOT the same
   * string and conflating them oscillates.
   *
   * Seeding plain `A hoodie` into a format that requires a block opener gives
   * `<p>A hoodie</p>`. A single ref comparing against the raw prop therefore let
   * an emit through on the first interaction, and a caller writing
   * `value === base ? undefined : value` recorded an override the operator never
   * made - which is how every freshly opened bulk variant panel started showing
   * "Description overridden / reset to base".
   *
   * - `appliedProp` is prop-space: the last `value` we pushed in. It decides
   *   whether an incoming prop is genuinely new.
   * - `appliedHtml` is editor-space: the editor's own serialization of that same
   *   value. It decides whether an update is a real edit or just normalization.
   */
  const appliedProp = useRef(value ?? '');
  const appliedHtml = useRef(value ?? '');
  /** Whether the mount-time restatement has been absorbed. See `onUpdate`. */
  const baselineAccepted = useRef(false);
  // A call site whose override field is optional can hand us `undefined` at
  // runtime even where the prop type says `string`. Normalising here keeps the
  // byte counter and the sync effect from throwing on it.
  const safeValue = value ?? '';

  const editor = useEditor(
    {
      extensions: buildRichTextExtensions(profile, placeholder),
      content: safeValue,
      editable: !disabled,
      onUpdate: ({ editor: instance }) => {
        const html = instance.getHTML();

        // Normalization is not an edit, and string equality cannot tell them
        // apart: seeding plain `A hoodie` into a format that requires a block
        // opener serializes as `<p>A hoodie</p>`, so the first update legitimately
        // differs from the prop it came from. Emitting it made a caller writing
        // `value === base ? undefined : value` record an override the operator
        // never made - every freshly opened bulk variant panel read
        // "Description overridden".
        //
        // `onCreate` is not usable for capturing the baseline; it does not run
        // before that first update. So the rule is textual: an update whose TEXT
        // matches the applied value's text, arriving before any baseline has been
        // accepted, is the editor restating what it was given.
        //
        // Residual, deliberately accepted: if no mount restatement happens and
        // the operator's first action is formatting-only (bolding a word alters
        // tags but not text), that one change is swallowed and the next keystroke
        // recovers it. That is much rarer than the restatement this prevents.
        if (!baselineAccepted.current) {
          baselineAccepted.current = true;
          if (textOf(html) === textOf(appliedProp.current)) {
            appliedHtml.current = html;
            return;
          }
        }

        if (html === appliedHtml.current) return;
        appliedHtml.current = html;
        appliedProp.current = html;
        onChange(html);
      },
      editorProps: {
        attributes: {
          ...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel }),
          ...(id === undefined ? {} : { id }),
          role: 'textbox',
          'aria-multiline': 'true',
          // Mirrors what `Input`/`Textarea` carry, so a migrated field keeps its
          // invalid state and its error association instead of losing both.
          ...(ariaInvalid === true ? { 'aria-invalid': 'true' } : {}),
          ...(ariaDescribedBy === undefined ? {} : { 'aria-describedby': ariaDescribedBy }),
        },
      },
    },
    // The schema is rebuilt when the destination's contract changes - a different
    // format is a different document shape - and not on an unrelated re-render.
    [formatSignature],
  );

  useEffect(() => {
    if (editor === null) return;
    if (safeValue === appliedProp.current) return;
    // An outside change (AI suggestion applied, draft discarded, row refetched).
    editor.commands.setContent(safeValue, { emitUpdate: false });
    appliedProp.current = safeValue;
    appliedHtml.current = editor.getHTML();
    // A newly applied outside value gets its own restatement allowance - the
    // editor may re-normalize it exactly as it did the seed.
    baselineAccepted.current = false;
  }, [editor, safeValue]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    // The editor is destroyed and rebuilt when the contract changes, and the new
    // instance restates the value under the NEW schema. Without resetting the
    // allowance, that restatement is reported as an operator edit - e.g. a value
    // seeded as `<strong>` under a format that rewrites bold to `<b>`, then
    // re-serialised as `<strong>` once a permissive format arrives, marks the
    // form dirty and records an override nobody asked for.
    baselineAccepted.current = false;
  }, [formatSignature]);

  // Deliberately NOT committed on blur. Clicking the "Rich text" toggle in a real
  // browser fires mousedown -> textarea blur -> click: a blur-driven exit flips
  // the mode to false, and the click handler then reads `sourceMode === false`
  // and re-enters source mode, so the toggle appears not to work. `fireEvent.click`
  // dispatches no blur, so the unit suite could not see it. The toggle is the only
  // commit point; the draft survives losing focus.
  const leaveSourceMode = useCallback(() => {
    // Round-trip through the schema so hand-edited markup is filtered exactly as
    // typed markup is - source mode is an escape hatch, not a bypass.
    editor?.commands.setContent(sourceDraft);
    setSourceMode(false);
  }, [editor, sourceDraft]);

  const enterSourceMode = useCallback(() => {
    setSourceDraft(editor?.getHTML() ?? safeValue);
    setSourceMode(true);
  }, [editor, value]);

  const buttons = useMemo(
    () => [...TOOLBAR.filter((b) => b.enabled(profile)), ...headingButtons(profile)],
    [profile],
  );

  const bytes = byteLength(safeValue);
  const overCap = profile.maxBytes !== null && bytes > profile.maxBytes;
  const nearCap = profile.maxBytes !== null && !overCap && bytes > profile.maxBytes * 0.8;

  if (format === null) {
    return (
      <div className={['rich-text', 'rich-text--loading', className].filter(Boolean).join(' ')}>
        <div className="rich-text__surface" aria-busy="true">
          <p className="rich-text__loading-note">Loading the destination's formatting rules…</p>
        </div>
      </div>
    );
  }

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
                button.id === 'italic' && profile.italicPublishesAsBold
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
            {/* Colour is never the only signal: the near state said "watch out"
                in amber and nothing else. */}
            {overCap ? ' — over the destination limit' : nearCap ? ' — near the limit' : ''}
          </span>
        )}
      </div>
    </div>
  );
}
