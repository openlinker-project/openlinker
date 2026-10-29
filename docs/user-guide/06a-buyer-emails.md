# Buyer emails

OpenLinker can email the buyer at four moments in an order's life:

| Email | Sent when | Allowed on |
|---|---|---|
| Order confirmed | OpenLinker takes a new order in for the first time | shops only (PrestaShop, WooCommerce, …) |
| Shipped | the order's parcels are handed to the carrier | shops and marketplaces |
| Document issued | the order's invoice or fiscal receipt is issued | shops and marketplaces |
| Return received | a returned parcel is received at your warehouse | shops and marketplaces |

Nothing is sent until you switch it on. Every connection starts with buyer
emails **off**, so upgrading OpenLinker never sends a buyer anything new.

On a marketplace (Allegro, Erli) only the three transactional emails can be
switched on, and they go to the address the marketplace gives you on the order
(on Allegro, a masked address). "Order confirmed" is a shop's own message and
is refused on a marketplace connection. There are no marketing emails.

---

## Switching buyer emails on

Open **Settings → Buyer emails** (admin only) and pick the connection.

1. Tick **Send buyer emails for this connection**. Until you do, nothing is
   sent for that connection, whatever else is set.
2. Click **Edit** next to an email and tick **Send this email**. Here you can
   also set a **sender address** and a **reply-to address** for this email on
   this connection. Leave the sender empty to use the one from the mail
   settings.
3. Adjust the **subject** and **message** if you like. Click a variable, such
   as `{order.reference}`, `{buyer.name}` or `{shipment.tracking}`, to insert
   it; the preview shows the result with sample values.
4. **Save changes.**

The subject and message are shared by every connection; the switches and
the sender belong to one connection. A marketplace connection does not list
"Order confirmed" at all, and the page says why.

### Sending a test

In the editor, type your own address under **Send a test** and click **Send
test email**. It sends the subject and message exactly as typed, with this
connection's sender, through the same mail transport real emails use. A test
is not recorded on any order, and it works even before the email is switched
on.

---

## What the order shows

Every attempt is recorded on the order, in one of three states:

- **Sent** - the email went out.
- **Not sent**, with the reason:
  - buyer emails are off for this order's connection;
  - this email is not switched on for the connection;
  - a marketplace does not send this email (the shop sends it);
  - no buyer email address is stored for the order (for example when buyer
    details are not stored at all);
  - the buyer already received this email.
- **Bounced** - the buyer's mail server refused the address.

The buyer gets each email **once**. A return that arrives in three parcels
still produces one "Return received" email; the other two arrivals are
recorded as "already received".

The record never shows the buyer's address, only what happened.

---

## Good to know

- "Return received" rules cannot be limited by the order's country or total:
  the return does not carry those facts, so such a condition never matches.
- If the email sender itself is down, nothing is recorded on the order; the
  failed step appears in the automation's run history instead, where you can
  retry it.
