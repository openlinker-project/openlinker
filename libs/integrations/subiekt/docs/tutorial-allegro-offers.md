# Subiekt GT to Allegro - Offers, Sets and Multipacks

Publish products from Subiekt GT as Allegro offers through the OpenLinker wizard, including a
**set** (several different products in one offer) and a **multipack** (the same product, N pieces),
then let orders flow back into Subiekt.

> Companion to [`tutorial.md`](./tutorial.md), which covers the bridge and invoicing. This guide
> starts where that one ends: the Subiekt connection already works.

Verified on the Allegro **sandbox** with Subiekt GT 1.90 and Sfera GT (trial licence).

---

## What you need

- A working Subiekt GT connection (see `tutorial.md`, parts 1-2). Products must be synced
  (**Products** page shows your `OLE2E-*` items).
- An Allegro connection (sandbox or production) with seller defaults filled in.
- Bridge `PublicBase` set to a **public** URL, so Allegro can download product photos
  (`/gt-image/<id>?s=<signature>` is the only path that needs to be reachable).
- Optional: an InPost connection and a routing rule, so labels are generated on order.

![Connections](./assets/allegro-offers/B-01-connections-list.png)

---

## Part 1 - Prepare the Allegro connection

1. Open the Allegro connection and set **Product catalog connection** to your Subiekt GT
   connection. Without it the wizard reports that every offer will fail.
2. Fill the **seller defaults**: ship-from location, responsible producer, safety information.
   Allegro requires them even for offers linked to a catalogue card.
3. Pick a shipping price list that contains the delivery methods you want to sell with.
4. Wait for the category tree to sync (**Jobs** shows `destination.taxonomy.sync`). A fresh
   sandbox syncs only the first levels; run it again if your category is not searchable.

![Allegro connection](./assets/allegro-offers/B-02-allegro-connection-edit.png)

---

## Part 2 - Pick products that Allegro can link to a catalogue card

This is the single biggest time saver.

| Offer type | Time to ACTIVE |
|---|---|
| EAN matches a **complete** Allegro catalogue card | ~15 seconds |
| EAN with no card (new product created inline) | several hours (Allegro verifies it) |

A card is usable only when **every parameter the category requires** has a value (brand,
capacity and so on). For sets the card's brand must not be protected
(`ProductHasProtectedBrand`). A single offer of a protected-brand card is fine; a set is not.

Give your Subiekt products real EANs taken from such cards. Look them up with
`GET /sale/products?phrase=<word>&category.id=<cat>` and keep cards where all required parameters
are present.

---

## Part 3 - Publish a single offer

1. **Listings** -> **Publish products**, tick the product, choose the Allegro connection.
2. Shared config: quantity, price, publish immediately.

   ![Picker](./assets/allegro-offers/A-01-picker.png)
   ![Shared config](./assets/allegro-offers/A-02-shared-config.png)

3. Review shows what blocks each row. A category must be chosen when the EAN has no card.

   ![Review blocked](./assets/allegro-offers/A-03-review-blocked.png)
   ![Category search](./assets/allegro-offers/A-04a-category-search.png)

4. Open the editor, fill the required parameters (for a card-linked offer most are inherited),
   save.

   ![Editor](./assets/allegro-offers/A-05-editor-params-filled.png)
   ![Review ready](./assets/allegro-offers/A-06-review-ready.png)

5. Confirm and watch the batch.

   ![Confirm](./assets/allegro-offers/A-07-confirm.png)
   ![Result](./assets/allegro-offers/A-10-batch-result.png)

Checkpoint: **Listings** shows the offer as active with the stock from Subiekt.

---

## Part 4 - Sets and multipacks

A bundle is defined **in OpenLinker** (`bundle_definitions`). A Subiekt kit (`komplet`) can seed
one: the bridge route `GET /api/products/{symbol}/komplet` returns its components and OpenLinker
reads them (BundleReader).

### Set: different products

Example: `OLE2E-ZESTAW-BIURKO` = mug x1 + mouse pad x1.

![Set definition](./assets/allegro-offers/S-04-bundle-definition-set.png)

On Allegro this becomes `productSet` with **two entries**, one card each. Stock of the set is
`min(floor(component stock / quantity))`.

![Set offer](./assets/allegro-offers/S-02-listing-detail-set.png)

### Multipack: one product, N pieces

Example: `OLE2E-3PAK-KUBEK` = mug x3.

![Multipack definition](./assets/allegro-offers/S-05-bundle-definition-multipack.png)

On Allegro this is **one** `productSet` entry with `quantity = 3`, not a separate product.

![Multipack offer](./assets/allegro-offers/S-03-listing-detail-multipack.png)

### Prove it is a real set or multipack

Do not trust the wizard alone. Read the offer back from Allegro
(`GET /sale/product-offers/{offerId}`) and check:

- set: `productSet` has one entry per component;
- multipack: one entry, `quantity.value` = N.

The public offer page is behind bot protection, so use the API.

### Components must be publishable

Each component needs a catalogue card (found by EAN, also outside the offer's own category), or
a name, photo and category for an inline product. Otherwise the preview reports
`PRODUCT_SET_COMPONENT_UNPUBLISHABLE`. Easiest path: publish each component as its own offer
first, then the set reuses their cards.

![All offers](./assets/allegro-offers/S-01-listings-all-offers.png)

---

## Part 5 - Gifts

A promotion adds a free product to an order, for example "buy coffee, get a mug".

![Promotion](./assets/allegro-offers/S-08-promotions.png)

The gift is not part of the Allegro offer. It affects the order and the documents.

---

## Part 6 - Shipping and documents

- **Routing rule**: Allegro delivery method -> InPost (carrier-managed), so a label is created
  after the order is accepted.

  ![Routing](./assets/allegro-offers/S-10-allegro-fulfilment-routing.png)

- **Subiekt connection**: `Auto on paid` with document kind `invoice`. A buyer without a tax id
  gets a receipt (PA); a buyer with one gets an invoice (FS).

  ![Documents](./assets/allegro-offers/S-11-sales-documents-settings.png)

---

## Part 7 - Buy and verify

After a test purchase, check in Subiekt:

| Where | Expect |
|---|---|
| Sales orders (ZK) | one ZK per Allegro order |
| Receipt (PA) or invoice (FS) | issued automatically when paid |
| Stock (`tw_Stan`) | decreased on the sold products |

Subiekt window for reference:

![Subiekt products](./assets/allegro-offers/SUB-01-towary-i-uslugi.png)
![Subiekt kit](./assets/allegro-offers/SUB-04-komplet-ZESO20-skladniki.png)

> **Known gap (tested on this branch).** Simple products flow end to end (ZK, PA, stock).
> Bundle and multipack orders currently reach Subiekt as **one line of the placeholder product**,
> which has stock 0, instead of the component lines. The receipt then fails and Sfera can crash
> ("Program zostal zamkniety z powodu bledu"). Until components are sent to Subiekt, give set and
> multipack products stock in Subiekt or do not issue documents automatically for them.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Wizard says every offer will fail | No product catalogue connection | Part 1, step 1 |
| `MissingRequiredParameters` | Card lacks category-required values | Pick a complete card (Part 2) |
| Offer stuck "activating" for hours | Inline product awaiting verification | Use an EAN with a card |
| `ProductHasProtectedBrand` | Set with a protected-brand card | Use unprotected cards for sets |
| Product name rejected (`0x80040E21`) | Subiekt name limit is 50 characters | Shorten the name |
| `0x800706BE` / InsERT crash dialog | Sfera call on a product with no stock | Click Cancel, fix stock, retry the destination sync |
| Sfera answers "no valid licence" | Sfera trial not activated | Activate in **My products** |
| All Sfera calls time out | Expired Subiekt trial dialog with only "Koniec" | Use a database with a valid licence |
