/**
 * Label-download error stub (#2671)
 *
 * Stubs the `/shipments` page's whole read surface so every label-download
 * failure class can be driven from a served web app alone - no seeded stack,
 * no shared auth artifact. Mirrors `tests/wizard-blockers/wizard-stub.ts`'s
 * session-bootstrap shape (auth refresh + `/auth/me` + a `system/**` catch-all)
 * since that stub already proved this pattern hermetic for a permission-gated
 * page.
 *
 * @module tests/label-download-errors
 */
import type { Page, Route } from '@playwright/test';

export const CONNECTION_ID = '00000000-0000-4000-8000-000000002671';
export const SHIPMENT_ID = 'ol_shipment_2671';
export const ORDER_ID = 'ol_order_2671';

const SESSION_PERMISSIONS = ['shipments:read', 'shipments:write', 'connections:read', 'connections:write'];

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Stub every OL route the `/shipments` page reads on load. */
export async function stubShipmentsPageApi(page: Page): Promise<void> {
  const now = new Date().toISOString();

  await page.route('**/v1/auth/refresh', (route) => json(route, { access_token: 'e2e-2671-token' }));
  await page.route('**/v1/auth/me', (route) =>
    json(route, {
      id: 'usr_e2e_2671',
      username: 'e2e-operator',
      email: 'e2e-operator@openlinker.local',
      role: 'admin',
      permissions: SESSION_PERMISSIONS,
      analyticsConsent: false,
    }),
  );
  await page.route('**/v1/system/**', (route) => json(route, {}));

  await page.route('**/v1/connections', (route) =>
    json(route, [
      {
        id: CONNECTION_ID,
        name: 'DPD Poland',
        platformType: 'dpd-polska',
        status: 'active',
        config: {},
        credentialsBacked: true,
        adapterKey: 'dpd-polska.rest.v1',
        enabledCapabilities: ['OrderProcessorManager'],
        supportedCapabilities: ['OrderProcessorManager'],
        defaultRateLimit: null,
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );

  await page.route('**/v1/shipments?*', (route) =>
    json(route, {
      items: [
        {
          id: SHIPMENT_ID,
          orderId: ORDER_ID,
          customerId: null,
          connectionId: CONNECTION_ID,
          shippingMethod: 'kurier',
          status: 'generated',
          providerShipmentId: 'DPD-9911',
          paczkomatId: null,
          sourceDeliveryMethodId: null,
          deliveryIntent: 'address',
          trackingNumber: null,
          providerCode: null,
          carrier: 'dpd',
          labelPdfRef: 'dpd:label:9911',
          dispatchedAt: null,
          deliveredAt: null,
          cancelledAt: null,
          failedAt: null,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
          orderSummary: null,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    }),
  );
}

/** One `GET /shipments/:id/label` failure per case, keyed exactly to what
 *  `apps/api/src/shipping/http/shipment.controller.ts`'s `toHttpException`
 *  actually produces (see `label-download-error.ts`'s own header comment). */
export type FailureCase =
  | 'not-found'
  | 'not-yet-generated'
  | 'carrier-unsupported'
  | 'provider-rejection'
  | 'provider-auth'
  | 'unclassified'
  | 'network';

export async function stubLabelDownloadFailure(page: Page, kind: FailureCase): Promise<void> {
  await page.route(`**/v1/shipments/${SHIPMENT_ID}/label`, async (route) => {
    switch (kind) {
      case 'not-found':
        return json(
          route,
          { statusCode: 404, message: `Shipment not found: ${SHIPMENT_ID}`, error: 'Not Found' },
          404,
        );
      case 'not-yet-generated':
        return json(
          route,
          {
            statusCode: 422,
            message: `No label has been generated for shipment ${SHIPMENT_ID} yet - generate the label first`,
            error: 'Unprocessable Entity',
          },
          422,
        );
      case 'carrier-unsupported':
        return json(
          route,
          {
            statusCode: 422,
            message: `Cannot fetch label for shipment ${SHIPMENT_ID}: connection ${CONNECTION_ID} does not support returning label documents`,
            error: 'Unprocessable Entity',
          },
          422,
        );
      case 'provider-rejection':
        return json(
          route,
          { message: 'Waybill reference expired for this shipment', providerCode: 'DPD.WAYBILL_EXPIRED' },
          502,
        );
      case 'provider-auth':
        return json(
          route,
          { statusCode: 502, message: 'Carrier credentials rejected', error: 'Bad Gateway' },
          502,
        );
      case 'unclassified':
        return json(
          route,
          { statusCode: 500, message: 'Unexpected token in JSON', error: 'Internal Server Error' },
          500,
        );
      case 'network':
        return route.abort('failed');
    }
  });
}
