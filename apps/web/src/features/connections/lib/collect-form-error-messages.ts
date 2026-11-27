/**
 * Collect form error messages
 *
 * Flattens a React Hook Form `FieldErrors` tree into the list of messages the
 * Edit connection form's `FormErrorSummary` renders (#3765). Several fields on
 * that form are objects (`rateLimit`, `stockPolicy`, `pricingRule`, plugin
 * fragments), so their errors sit one or more levels down - reading only the
 * top level left the summary empty and the save silently refused.
 *
 * @module features/connections/lib
 */

// `ref` holds the DOM element a field is registered to; walking into it would
// traverse the whole document - and, because DOM nodes hold parent/child
// back-references, would never terminate. Skipping it is therefore also the
// cycle guard, so no visited-set is needed. `types` duplicates `message` under
// `criteriaMode: 'all'`.
const SKIPPED_KEYS = new Set(['ref', 'types', 'message', 'type']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function walk(node: unknown, messages: string[]): void {
  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, messages);
    return;
  }
  if (!isRecord(node)) return;

  if (typeof node.message === 'string' && node.message.length > 0) {
    messages.push(node.message);
  }
  for (const [key, child] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(key)) continue;
    walk(child, messages);
  }
}

/**
 * Returns every error message in the tree, in field order, without duplicates
 * (the summary keys its list items by message).
 */
export function collectFormErrorMessages(errors: unknown): string[] {
  const messages: string[] = [];
  walk(errors, messages);
  return [...new Set(messages)];
}
