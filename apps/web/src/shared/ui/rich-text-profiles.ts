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

  return {
    marks: (Object.keys(MARK_TAGS) as RichTextMark[]).filter((mark) =>
      MARK_TAGS[mark].some(has),
    ),
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
