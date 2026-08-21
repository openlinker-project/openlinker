/**
 * Rich Text Profiles
 *
 * Derives everything the editor needs from a destination's declared
 * `DescriptionFormat` (ADR-046). This module is the reason the frontend holds no
 * destination knowledge: it reads the format object and nothing else - no
 * platform names, no per-marketplace table, no `platformType` switch.
 *
 * Adding a control therefore means a destination declared a tag, not that
 * someone picked one. Erli shows an H3 button and Allegro does not because
 * Erli's declaration lists `h3`.
 *
 * @module apps/web/src/shared/ui
 */
import Bold from '@tiptap/extension-bold';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import { BulletList, ListItem, ListKeymap, OrderedList } from '@tiptap/extension-list';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import Underline from '@tiptap/extension-underline';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import type { AnyExtension } from '@tiptap/core';

import type { DescriptionFormat, RichTextMark } from './rich-text.types';

/**
 * Which tags express each mark. A format that allows any of them enables the
 * control; the first one it allows decides what the mark serialises to.
 */
const MARK_TAGS: Readonly<Record<RichTextMark, readonly string[]>> = {
  bold: ['b', 'strong'],
  italic: ['i', 'em'],
  underline: ['u'],
  strike: ['s', 'del'],
};

export interface RichTextProfile {
  marks: RichTextMark[];
  /** The tag bold serialises to. Allegro rejects `<strong>` and accepts `<b>`. */
  boldTag: 'b' | 'strong';
  /**
   * True when italic is offered only because the destination REWRITES it to
   * bold, not because it has an italic tag. ADR-046 subordinate decision 2: the
   * mark stays authorable (the operator's emphasis survives as bold) and the
   * lossy conversion is stated on the control.
   */
  italicPublishesAsBold: boolean;
  hardBreak: boolean;
  headingLevels: number[];
  /** False when the format says a heading accepts no children at all. */
  headingMarks: boolean;
  bulletList: boolean;
  orderedList: boolean;
  links: boolean;
  maxBytes: number | null;
}

export function deriveRichTextProfile(format: DescriptionFormat): RichTextProfile {
  const has = (tag: string): boolean => format.allowedTags.includes(tag);
  const headingLevels = [1, 2, 3, 4, 5, 6].filter((level) => has(`h${level}`));

  // A heading that declares an empty child list accepts text only. Read from the
  // content model rather than assumed, because a permissive shop allows marks
  // inside a heading and a marketplace does not.
  const headingsRejectMarks = headingLevels.some(
    (level) => (format.contentModel?.[`h${level}`] ?? null)?.length === 0,
  );

  // A destination that rewrites `i`/`em` to bold still ACCEPTS the operator's
  // emphasis - it just publishes it as bold. Hiding the control there loses the
  // intent entirely and leaves the operator no way to express it, which is why
  // ADR-046 chose rename-with-a-note over unwrap. Allegro is exactly this case:
  // its tag list has no `i`, and its rewrites turn `i`/`em` into `b`.
  const italicRewritesToBold = (format.rewrites ?? []).some(
    (rule) =>
      rule.action === 'rename' &&
      rule.to !== undefined &&
      ['i', 'em'].includes(rule.from.toLowerCase()) &&
      MARK_TAGS.bold.includes(rule.to.toLowerCase()),
  );

  const marks = (Object.keys(MARK_TAGS) as RichTextMark[]).filter((mark) =>
    MARK_TAGS[mark].some(has),
  );
  if (!marks.includes('italic') && italicRewritesToBold) marks.push('italic');

  return {
    marks,
    italicPublishesAsBold: !MARK_TAGS.italic.some(has) && italicRewritesToBold,
    boldTag: has('strong') ? 'strong' : 'b',
    hardBreak: has('br'),
    headingLevels,
    headingMarks: !headingsRejectMarks,
    bulletList: has('ul') && has('li'),
    orderedList: has('ol') && has('li'),
    links: has('a'),
    maxBytes: format.maxBytes,
  };
}

/**
 * The Tiptap extension set for a profile. The registered extensions ARE the
 * document schema, so an unlisted tag cannot be authored or pasted in - the
 * filtering happens at parse time rather than as a pass afterwards.
 */
export function buildRichTextExtensions(
  profile: RichTextProfile,
  placeholder: string,
): AnyExtension[] {
  const extensions: AnyExtension[] = [
    Document,
    Paragraph,
    Text,
    UndoRedo,
    Placeholder.configure({ placeholder }),
  ];

  if (profile.hardBreak) extensions.push(HardBreak);

  if (profile.marks.includes('bold')) {
    // The destination decides the tag, not the library default: Tiptap emits
    // `<strong>`, which Allegro rejects outright.
    extensions.push(
      profile.boldTag === 'b' ? Bold.extend({ renderHTML: () => ['b', 0] }) : Bold,
    );
  }
  // Emits `<em>` even where the destination rewrites it to bold: the stored
  // draft keeps the operator's intent, and the OUTBOUND applier is what narrows
  // it (ADR-046 - the format is a publish-time contract, not a storage one).
  if (profile.marks.includes('italic')) extensions.push(Italic);
  if (profile.marks.includes('underline')) extensions.push(Underline);
  if (profile.marks.includes('strike')) extensions.push(Strike);

  if (profile.headingLevels.length > 0) {
    const heading = profile.headingMarks ? Heading : Heading.extend({ marks: '' });
    extensions.push(heading.configure({ levels: profile.headingLevels as never }));
  }

  if (profile.bulletList || profile.orderedList) {
    extensions.push(ListItem, ListKeymap);
    if (profile.bulletList) extensions.push(BulletList);
    if (profile.orderedList) extensions.push(OrderedList);
  }

  if (profile.links) extensions.push(Link.configure({ openOnClick: false }));

  return extensions;
}

/** UTF-8 byte length, matching how the backend measures a destination's cap. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Is `value` longer than the destination's declared byte cap?
 *
 * The counter next to the editor is informational; this is what a submit
 * surface gates on. Every surface that can send a description has to ask,
 * because the cap belongs to the destination and the platform rejects the
 * whole write - the operator would otherwise learn about it from a 422 on a
 * job they already dispatched. Returns `false` while the contract is still in
 * flight (`format === null`): a cap nobody has declared cannot be exceeded.
 */
export function exceedsDescriptionCap(
  value: string,
  format: Pick<DescriptionFormat, 'maxBytes'> | null | undefined,
): boolean {
  const cap = format?.maxBytes ?? null;
  if (cap === null || value === '') return false;
  return byteLength(value) > cap;
}
