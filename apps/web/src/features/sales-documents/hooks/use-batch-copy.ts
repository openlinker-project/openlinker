/**
 * useBatchCopy (#3584 review)
 *
 * The batch-issuing screen's copy (`sales-documents` `batch`) and a plural
 * function, both for the active language. The pure helpers in
 * `lib/describe-batch-run.ts` take this pair instead of building English.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useMemo } from 'react';
import { useMessages, usePlural } from '../../../shared/i18n';
import type { BatchCopyContext } from '../lib/describe-batch-run';

export function useBatchCopy(): BatchCopyContext {
  const copy = useMessages('sales-documents').batch;
  const plural = usePlural();
  return useMemo(() => ({ copy, plural }), [copy, plural]);
}
