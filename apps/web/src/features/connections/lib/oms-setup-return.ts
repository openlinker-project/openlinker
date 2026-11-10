/**
 * OMS setup return link (#3958)
 *
 * The OMS setup's Shipping step sends an operator off to connect a carrier and
 * expects them back on that step afterwards. It marks the trip with
 * `?from=oms-setup`, and every page on the way (the platform picker, the
 * carrier wizard, the new connection's detail page) keeps the marker and
 * offers the way back.
 *
 * The param is only ever COMPARED with a literal, never used as a URL: a
 * `from` value that named a path would let any link send the operator
 * anywhere. The return target is fixed here. Same rule as `from=shipments` on
 * the order detail page.
 *
 * @module features/connections/lib
 */

export const OMS_SETUP_FROM_PARAM = 'from';
export const OMS_SETUP_FROM_VALUE = 'oms-setup';
export const OMS_SETUP_RETURN_PATH = '/settings/packing?step=shipping';

/** Whether the current page was reached from the OMS setup. */
export function isFromOmsSetup(searchParams: URLSearchParams): boolean {
  return searchParams.get(OMS_SETUP_FROM_PARAM) === OMS_SETUP_FROM_VALUE;
}

/**
 * Appends the OMS setup marker to an in-app path when the trip started there,
 * so the next page can still offer the way back. A path that already carries
 * a query string keeps it.
 */
export function withOmsSetupReturn(path: string, fromOmsSetup: boolean): string {
  if (!fromOmsSetup) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${OMS_SETUP_FROM_PARAM}=${OMS_SETUP_FROM_VALUE}`;
}

/** Search param a carrier wizard sets on the detail page it lands on. */
export const CONNECTION_CREATED_PARAM = 'created';

/**
 * Where a carrier wizard sends the operator once the connection exists: its
 * detail page, flagged so the page can say what to do next.
 */
export function createdConnectionLandingPath(connectionId: string, fromOmsSetup: boolean): string {
  return withOmsSetupReturn(
    `/connections/${connectionId}?${CONNECTION_CREATED_PARAM}=1`,
    fromOmsSetup
  );
}
