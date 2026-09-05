/**
 * Printing a document at the bench (#2418, `W3b-5`, story F1)
 *
 * The bench PRINTS. It never issues, and this module is the whole of what
 * "print" means here: bytes that already existed are handed to the browser's own
 * print dialog.
 *
 * ## A hidden frame, not a new window
 *
 * A bench tablet is chromeless and a packer has a box in one hand. `window.open`
 * is the obvious route and is the wrong one twice over: a pop-up blocker turns a
 * print into a silent no-op, and a new window is a way OUT of the bench, which
 * story C2 spends the whole surface avoiding. A same-document frame prints
 * without either.
 *
 * The object URL is revoked on a timer rather than immediately after `print()`:
 * some engines cancel an in-flight render if the URL goes away synchronously —
 * the same reason `triggerBlobDownload` defers its own revoke.
 *
 * @module apps/web/src/features/bench/lib
 */

/** How long the frame is kept alive after printing, in ms. */
const PRINT_FRAME_LIFETIME_MS = 60_000;

/**
 * Hand an already-fetched document to the printer.
 *
 * Returns `false` when the browser gives us nothing to print with — an
 * environment without `createObjectURL`, or a frame that never got a document.
 * The caller says so rather than reporting a print that did not happen, because
 * a packer who believes the invoice printed will tape the box shut without it.
 */
export function printBlob(blob: Blob): boolean {
  if (typeof URL.createObjectURL !== 'function') return false;

  const objectUrl = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.src = objectUrl;

  const cleanUp = (): void => {
    frame.remove();
    if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl);
  };

  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      // A frame that refuses to print is not a failure we can report from here
      // — the load already succeeded — so the document simply stays on screen
      // in the frame until the timer clears it.
    }
    setTimeout(cleanUp, PRINT_FRAME_LIFETIME_MS);
  };

  document.body.appendChild(frame);
  return true;
}
