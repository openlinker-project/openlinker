/**
 * Matching a scan to a line of THIS box (#2418, `W3b-5`, story E2)
 *
 * Pure functions over the parcel the browser already holds. No I/O, no request,
 * no storage — which is the whole point rather than a style choice.
 *
 * ## The wrong item is refused IN THE BROWSER, and sends nothing
 *
 * E2 asks the surface to refuse a wrong item, *name what it expected and what it
 * got*, and record nothing. The parcel read already returns every line's `ean`,
 * `gtin` and `sku`, so the answer is here. Asking the server would be a round
 * trip whose only possible reply is "no such line" — a request made in order to
 * be told nothing happened, at the moment a packer is holding a box, on a bench
 * that may be on a bad wireless link.
 *
 * The verify request is therefore never sent for an unmatched scan, which is
 * also what makes D20 true from the other side: the wire carries a LINE, so
 * there is nothing on it that could distinguish a scan from a hand-confirm, and
 * nothing that could record a barcode we refused.
 *
 * ## Comparison is exact after normalising, never fuzzy
 *
 * Trimmed, upper-cased, and inner whitespace removed — that covers a scanner
 * emitting a trailing space or a SKU stored with a stray one. It deliberately
 * does NOT strip leading zeros or check digits: a GTIN-13 and a GTIN-14 that
 * differ only in a leading zero are two different products in a catalogue that
 * carries both, and quietly equating them would put the wrong item in a box —
 * exactly the failure this module exists to prevent. The search field on the
 * work list is forgiving because finding a tote is a human act; matching an item
 * into a box is not.
 *
 * A blank value never matches anything, so a line with no barcode at all cannot
 * be reached by scanning. That line is what the hand-confirm control is for
 * (E4), and a surface that let an empty scan satisfy it would confirm a
 * different line than the packer was looking at.
 *
 * @module apps/web/src/features/bench/lib
 */
import type { BenchParcel, BenchParcelLine } from '../api/bench-parcel.types';

/** What a scan meant, if anything, for this box. */
export type ParcelScanMatch =
  | {
      /** Exactly one line carries this code and still has room. */
      readonly kind: 'matched';
      readonly line: BenchParcelLine;
    }
  | {
      /**
       * The code belongs to this box, but every line carrying it is already
       * full. Told apart from `no-match` because the packer's remedy differs
       * completely: one means "wrong item", the other means "this box takes no
       * more of that". Refused here rather than sent, so a full line never
       * spends a round trip to be answered `over-packed`.
       */
      readonly kind: 'already-full';
      readonly line: BenchParcelLine;
    }
  | {
      /** Nothing in this box carries this code. */
      readonly kind: 'no-match';
    };

/**
 * Normalise a scanned value or a catalogue code for comparison.
 *
 * Exported because the surface renders the raw scan back to the packer and the
 * test suite compares against the same rule; a second normalisation spelled
 * anywhere else is a second matching rule.
 */
export function normaliseScanValue(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** Every code this line can be reached by, normalised, blanks dropped. */
export function lineScanCodes(line: BenchParcelLine): readonly string[] {
  return [line.ean, line.gtin, line.sku]
    .map((code) => (code === null ? '' : normaliseScanValue(code)))
    .filter((code) => code.length > 0);
}

/**
 * Which line of this box did the packer just scan?
 *
 * Lines with room are preferred over full ones, so a two-unit line scanned twice
 * matches on both scans, and only a third scan reports `already-full`. Ordering
 * within each group follows the parcel's own line order — a box with the same
 * code on two lines is a catalogue oddity rather than a decision to make here.
 */
export function matchScanToParcelLine(parcel: BenchParcel, scanned: string): ParcelScanMatch {
  const wanted = normaliseScanValue(scanned);
  if (wanted.length === 0) return { kind: 'no-match' };

  const carrying = parcel.lines.filter((line) => lineScanCodes(line).includes(wanted));
  if (carrying.length === 0) return { kind: 'no-match' };

  const withRoom = carrying.find((line) => line.verifiedQuantity < line.requiredQuantity);
  if (withRoom !== undefined) return { kind: 'matched', line: withRoom };

  return { kind: 'already-full', line: carrying[0] };
}

/**
 * What this box was expecting, for the refusal to name.
 *
 * E2 requires the refusal to say what it expected as well as what it got, so the
 * surface has to be able to render the box's own codes. Only lines with room
 * are listed: telling a packer to look for something already in the box would
 * send them to fetch a second one.
 */
export function outstandingScanCodes(parcel: BenchParcel): readonly string[] {
  const codes: string[] = [];
  for (const line of parcel.lines) {
    if (line.verifiedQuantity >= line.requiredQuantity) continue;
    for (const code of lineScanCodes(line)) {
      if (!codes.includes(code)) codes.push(code);
    }
  }
  return codes;
}
