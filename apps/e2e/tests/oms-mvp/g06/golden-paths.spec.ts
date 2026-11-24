/**
 * G06 golden paths - sales documents and buyer emails, end to end (#3556)
 *
 * 1. A KSeF invoice is issued and cleared; its FA(3) preview shows the KOD I
 *    QR, and "Email to buyer" sends it to an EDITED recipient through
 *    OpenLinker's mailer. The PDF attachment needs #3620 (OpenLinker's own
 *    FA(3) PDF); until that is on the stack the document is attached as its
 *    verification link, which is annotated rather than failed.
 * 2. Buyer emails are on for an Allegro order's connection; dispatching the
 *    order sends the "shipped" email (from the worker) and the order's
 *    buyer-email history reads `sent`.
 * 3. Buyer emails are off for the order's connection; dispatching sends
 *    nothing and the history reads `suppressed / emails-off-for-connection`.
 *
 * Every path restores what it changed (rule `isActive`, connection config).
 * Paths 2-3 buy a real InPost label and release it after; each skips with
 * its reason when the stack lacks KSeF, Allegro, InPost or a paczkomat id.
 *
 * @module tests/oms-mvp/g06
 */
import { test, expect } from '../../../src/fixtures/test';
import { shot } from '../../../src/support/shot';
import {
  buildPickupRecipient,
  releaseDispatchedShipments,
  resolveDispatchedShipment,
  setUpShippingTestOrder,
  shippingOrderShortageReason,
} from '../../../src/support/shipments';
import {
  armRule,
  findBuyerEmailRule,
  setBuyerEmails,
  waitForBuyerEmail,
} from '../../../src/support/buyer-emails';
import { issueAndClear, ksefOrder, requireKsef } from '../../ksef-legal/ksef-legal.helpers';

const FOLDER = 'g06';
const EDITED_RECIPIENT = 'g06-edited-recipient@example.com';

test.describe('G06 golden paths (#3556)', () => {
  test.afterAll(async ({ api }) => {
    await releaseDispatchedShipments(api);
  });

  test('1: a cleared KSeF invoice shows KOD I and is emailed to an edited recipient', async ({
    api,
    world,
    jobs,
    poll,
    page,
  }, testInfo) => {
    const ksef = requireKsef(world);
    const synthesized = await ksefOrder({ api, world, jobs, poll });
    const orderId = synthesized.order.internalOrderId;
    const invoice = await issueAndClear({ api, jobs, poll }, ksef, orderId);
    expect(invoice.regulatoryStatus, 'KSeF TEST cleared the invoice').toBe('accepted');

    const attachment = await api.buyerEmails.invoiceAttachment(invoice.id);
    if (attachment.state !== 'pdf') {
      testInfo.annotations.push({
        type: 'needs-#3620',
        description: `attachment is "${attachment.state}", not "pdf": OpenLinker's FA(3) PDF is not on this stack`,
      });
    }

    await page.goto(`/orders/${encodeURIComponent(orderId)}`);
    await page.getByRole('button', { name: /^view$/i }).first().click();
    await expect(page.getByRole('img', { name: 'KSeF invoice verification QR code' })).toBeVisible();
    await shot(page, testInfo, 'gp1-ksef-kod1', FOLDER);

    await page.getByTestId('send-document-email-recipient').fill(EDITED_RECIPIENT);
    await page.getByTestId('send-document-email-button').click();
    await expect(page.getByText('Document emailed to buyer', { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await shot(page.getByTestId('send-document-email'), testInfo, 'gp1-email-sent', FOLDER);

    const attempts = await api.buyerEmails.documentEmailsForOrder(orderId);
    const sent = attempts.find((entry) => entry.documentId === invoice.id);
    expect(sent?.outcome, 'the send is recorded as sent').toBe('sent');
    expect(sent?.sentVia, 'KSeF has no mailer of its own, so OpenLinker sends').toBe('openlinker');
  });

  test('2: an Allegro order that opted in gets the "shipped" email', async ({
    api,
    world,
    env,
    poll,
    page,
  }, testInfo) => {
    test.skip(!env.paczkomatId, 'needs E2E_PACZKOMAT_ID to buy a paczkomat label');
    const setup = await setUpShippingTestOrder(api, world, env);
    test.skip(!setup, `no InPost connection, or ${shippingOrderShortageReason()}`);
    const { order, deliveryMethodId } = setup!;
    const source = await api.connections.getById(order.sourceConnectionId);
    test.skip(source.platformType !== 'allegro', 'the shipping test order is not an Allegro order');
    const rule = await findBuyerEmailRule(api, 'shipped');
    test.skip(!rule, 'the buyer-email seed migration has not run on this stack');

    const restoreRule = await armRule(api, rule!);
    const restoreConfig = await setBuyerEmails(api, order.sourceConnectionId, {
      enabled: true,
      templates: { shipped: { enabled: true } },
    });
    try {
      const dispatch = await api.shipments.generateLabel({
        sourceConnectionId: order.sourceConnectionId,
        sourceDeliveryMethodId: deliveryMethodId,
        orderId: order.internalOrderId,
        deliveryIntent: 'pickup_point',
        recipient: buildPickupRecipient(order),
        parcel: { template: 'small' },
        paczkomatId: env.paczkomatId!,
      });
      await resolveDispatchedShipment(api, dispatch, order.internalOrderId);

      const email = await waitForBuyerEmail(api, poll, order.internalOrderId, 'shipped');
      expect(email.outcome, 'the masked Allegro address received the email').toBe('sent');

      await page.goto(`/orders/${encodeURIComponent(order.internalOrderId)}`);
      await expect(page.getByTestId('order-buyer-email-row').first()).toHaveAttribute(
        'data-outcome',
        'sent'
      );
      await shot(page.getByTestId('order-buyer-emails'), testInfo, 'gp2-shipped-sent', FOLDER);
    } finally {
      await restoreConfig().catch(() => undefined);
      await restoreRule().catch(() => undefined);
    }
  });

  test('3: an order whose connection did not opt in gets nothing, with the reason', async ({
    api,
    world,
    env,
    poll,
    page,
  }, testInfo) => {
    test.skip(!env.paczkomatId, 'needs E2E_PACZKOMAT_ID to buy a paczkomat label');
    const setup = await setUpShippingTestOrder(api, world, env);
    test.skip(!setup, `no InPost connection, or ${shippingOrderShortageReason()}`);
    const { order, deliveryMethodId } = setup!;
    const rule = await findBuyerEmailRule(api, 'shipped');
    test.skip(!rule, 'the buyer-email seed migration has not run on this stack');

    const restoreRule = await armRule(api, rule!);
    const restoreConfig = await setBuyerEmails(api, order.sourceConnectionId, {
      enabled: false,
      templates: {},
    });
    try {
      const dispatch = await api.shipments.generateLabel({
        sourceConnectionId: order.sourceConnectionId,
        sourceDeliveryMethodId: deliveryMethodId,
        orderId: order.internalOrderId,
        deliveryIntent: 'pickup_point',
        recipient: buildPickupRecipient(order),
        parcel: { template: 'small' },
        paczkomatId: env.paczkomatId!,
      });
      await resolveDispatchedShipment(api, dispatch, order.internalOrderId);

      const email = await waitForBuyerEmail(api, poll, order.internalOrderId, 'shipped');
      expect(email.outcome).toBe('suppressed');
      expect(email.suppressionReason).toBe('emails-off-for-connection');

      await page.goto(`/orders/${encodeURIComponent(order.internalOrderId)}`);
      const panel = page.getByTestId('order-buyer-emails');
      await expect(panel).toHaveAttribute('data-mk-state', 'order-suppressed');
      // Every template is off on this connection, so each one that fired shows
      // the same reason: read the Shipped row's.
      await expect(
        panel
          .getByRole('listitem')
          .filter({ hasText: 'Shipped' })
          .getByTestId('order-buyer-email-reason')
      ).toContainText("Buyer emails are off for this order's connection.");
      await shot(panel, testInfo, 'gp3-shipped-suppressed', FOLDER);
    } finally {
      await restoreConfig().catch(() => undefined);
      await restoreRule().catch(() => undefined);
    }
  });
});
