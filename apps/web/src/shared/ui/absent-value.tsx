/**
 * Absent Value (#2253)
 *
 * The one renderer for "this value is absent", as distinct from "this value is
 * zero". A visible em-dash carries the distinction for a sighted reader; the
 * wording carries it for everyone else.
 *
 * The wording is rendered **visually hidden** rather than as an `aria-label`.
 * `EmptyValue` names itself with `aria-label` on a bare `<span>`, a generic
 * element ARIA prohibits naming, and screen readers commonly drop it - so on
 * the surfaces where absence-versus-zero is the actual claim, the label is not
 * reliably announced at all.
 *
 * Promoted out of `pages/listings/listings-list-page.tsx`, where it was
 * file-local. Absence versus zero is the central claim of the per-line
 * tax-rate work (#2245): a rate of `0` is a real answer - export, intra-EU,
 * exempt goods - and "we have no rate" is a different fact that holds the
 * document. Two implementations of that distinction would eventually disagree.
 *
 * `EmptyValue` stays as-is for the ordinary "nothing here" cell, where the
 * absent-versus-zero question does not arise.
 *
 * @module apps/web/src/shared/ui
 */
import type { ReactElement } from 'react';

import { EmptyValue } from './empty-value';

interface AbsentValueProps {
  /** What is absent, in words. Announced; also carried on the dash. */
  label: string;
}

export function AbsentValue({ label }: AbsentValueProps): ReactElement {
  return (
    <>
      <EmptyValue label={label} />
      <span className="sr-only">{label}</span>
    </>
  );
}
