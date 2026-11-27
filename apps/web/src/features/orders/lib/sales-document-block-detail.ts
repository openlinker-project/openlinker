/**
 * Sales-document block detail (#3866)
 *
 * The sentence that elaborates why an order got no sales document, built from
 * the block's params in the active language. When a block has no params (it
 * was written before #3866, or its reason has none to give) the backend's
 * English `detail` is shown under the "not translated" label instead, so a
 * developer detail never passes for operator copy.
 *
 * Pure; reads copy at call time so it follows the active language.
 *
 * @module apps/web/src/features/orders/lib
 */
import { getMessages, interpolate } from '../../../shared/i18n';
import type {
  SalesDocumentBlockParams,
  SalesDocumentGateBlockReasonValue,
  SalesDocumentUnresolvedReasonValue,
} from '../api/orders.types';

export interface SalesDocumentBlockDetailInput {
  readonly reason: SalesDocumentGateBlockReasonValue | null | undefined;
  readonly unresolvedReason: SalesDocumentUnresolvedReasonValue | null | undefined;
  readonly detail: string | null | undefined;
  readonly params: SalesDocumentBlockParams | null | undefined;
}

type DetailCopy = ReturnType<typeof getMessages<'orders'>>['salesDocumentBlockDetail'];

function documentsLabel(capabilities: readonly string[], c: DetailCopy): string {
  const names: Record<string, string | undefined> = c.capabilities;
  const words = capabilities.map((capability) => names[capability] ?? capability);
  return words.reduce((a, b) => interpolate(c.capabilities.or, { a, b }));
}

function routedSentence(params: SalesDocumentBlockParams, c: DetailCopy): string | null {
  if (!params.connectionId || !params.connectionState) return null;
  const head = params.ruleId
    ? interpolate(c.routedByRule, { ruleId: params.ruleId, connectionId: params.connectionId })
    : interpolate(c.routed, { connectionId: params.connectionId });
  const states: Record<string, string | undefined> = c.connectionState;
  const template = states[params.connectionState];
  if (template === undefined) return null;
  const tail =
    params.connectionState === 'missing-capability'
      ? interpolate(c.connectionState['missing-capability'], {
          documents: documentsLabel(params.missingCapabilities ?? [], c),
        })
      : template;
  return `${head} ${tail}`;
}

function sentenceFromParams(
  input: SalesDocumentBlockDetailInput,
  params: SalesDocumentBlockParams,
  c: DetailCopy,
): string | null {
  if (input.reason === 'missing-tax-rate') {
    if (params.taxRateScope === 'shipping') return c.shippingWithoutRate;
    if (params.lineCount === undefined || params.totalLines === undefined) return null;
    const lines = interpolate(c.linesWithoutRate, {
      lineCount: params.lineCount,
      totalLines: params.totalLines,
    });
    return params.firstLineRef
      ? `${lines} ${interpolate(c.firstLine, { ref: params.firstLineRef })}`
      : lines;
  }
  if (input.reason !== 'unresolved-routing') return null;
  switch (input.unresolvedReason) {
    case 'no-connection-declares-document-kind':
      return params.candidateCount === undefined
        ? null
        : interpolate(c.noKindDeclared, { n: params.candidateCount });
    case 'ambiguous-connection-no-primary':
      if (params.eligibleCount === undefined) return null;
      return interpolate(params.primaryCount === 0 ? c.nonePrimary : c.severalPrimary, {
        n: params.eligibleCount,
      });
    case 'routed-connection-unavailable':
      return routedSentence(params, c);
    case 'unsupported-document-kind-on-connection':
      if (!params.connectionId) return null;
      if (params.documentKind === 'invoice' || params.documentKind === undefined) {
        return interpolate(c.invoiceUnsupported, { connectionId: params.connectionId });
      }
      return interpolate(c.kindUnsupported, {
        connectionId: params.connectionId,
        documentKind: params.documentKind,
      });
    default:
      return params.eligibleCount === undefined
        ? null
        : interpolate(c.candidates, { n: params.eligibleCount });
  }
}

/**
 * The block's elaboration for an operator screen, or `null` when there is
 * nothing to add to the reason's own title.
 */
export function describeSalesDocumentBlockDetail(
  input: SalesDocumentBlockDetailInput,
): string | null {
  const c = getMessages('orders').salesDocumentBlockDetail;
  const sentence = input.params ? sentenceFromParams(input, input.params, c) : null;
  if (sentence) return sentence;
  if (!input.detail) return null;
  return interpolate(getMessages('ui').apiError.technicalDetailsWith, { details: input.detail });
}
