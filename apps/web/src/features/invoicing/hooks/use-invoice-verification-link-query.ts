/**
 * useInvoiceVerificationLinkQuery (DEF-02 / DEF-03 / DEF-15)
 *
 * Reads the authority's verification link for a cleared invoice from the
 * server, which builds it from the document it actually submitted. The browser
 * used to hash the XML itself, which needed Web Crypto (absent outside a secure
 * context, so the code silently vanished), the connection environment (hidden
 * from non-admins, so operators got the test portal), and a host table of its
 * own (which had drifted from the authority's). One source now answers all
 * three.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';

export function useInvoiceVerificationLinkQuery(
  invoiceId: string,
  enabled: boolean,
): UseQueryResult<{ url: string | null }> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: invoicingQueryKeys.verificationLink(invoiceId),
    enabled: enabled && Boolean(invoiceId),
    queryFn: () => apiClient.invoicing.getVerificationLink(invoiceId),
    staleTime: Infinity,
  });
}
