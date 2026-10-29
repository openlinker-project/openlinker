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

Two things must both be on for an email to go out.

**1. The connection's opt-in.** On the connection's Edit page, in the raw
configuration, add a `buyerEmails` block. Turn the emails on as a whole, then
switch on each email you want:

```json
"buyerEmails": {
  "enabled": true,
  "templates": {
    "shipped": { "enabled": true, "replyTo": "help@your-shop.pl" },
    "document-issued": { "enabled": true },
    "return-received": { "enabled": true },
    "order-confirmed": { "enabled": true, "fromAddress": "orders@your-shop.pl" }
  }
}
```

`fromAddress` and `replyTo` are optional and per email. Leave them out to use
the sender from the mail settings. Each must be a single plain address.

**2. The automation rule.** OpenLinker ships one ready-made rule per email,
named `Buyer email: …`, switched **off**. Open **Automations**, find the rule,
adjust the subject and body if you like, and switch it on. The text can use the
usual merge fields, such as `{order.reference}`, `{buyer.name}`, `{order.total}`
and `{shipment.tracking}`.

A dedicated settings screen for buyer emails is planned; until then the two
steps above are the way to set it up.

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
