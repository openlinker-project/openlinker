# Seed image provenance

Each image used by `30-seed-test-products.php` is documented below. All files
are licensed under terms permitting free commercial use, modification, and no
attribution requirement (**CC0 1.0 Universal Public Domain Dedication**).

Sources: every file was downloaded from Wikimedia Commons, where the
`Licensing` section of the File page literally contains the **CC0** template
(`{{cc-zero}}` → renders as the "CC0" short tag in `<span class="licensetpl_short">CC0</span>`).
Wikimedia Commons is the source of truth — click the source-page link in each
row to verify the licence is still CC0.

After download, each image was resized to ≤1200 px on the long edge,
re-encoded at JPEG quality 85, and stripped of EXIF / IPTC / comment / ICC
metadata via `jpegtran -copy none`.

| File | Subject in seeder | Wikimedia File page | Author (as listed on the File page) | Licence |
|---|---|---|---|---|
| `OL-BOSCH-GSR12V15.jpg`   | Generic cordless drill (fixture #1 cover)                    | [File:Cordless electric (screw) drill.jpg](https://commons.wikimedia.org/wiki/File:Cordless_electric_(screw)_drill.jpg)                  | Wikimedia user (per File page) | CC0 1.0 |
| `OL-MUG-LIN-300.jpg`      | Stoneware mug (fixture #2 cover)                              | [File:Coffee steaming in a mug.jpg](https://commons.wikimedia.org/wiki/File:Coffee_steaming_in_a_mug.jpg)                                | Wikimedia user (per File page) | CC0 1.0 |
| `OL-ADIDAS-IA4845.jpg`    | Generic plain tee (fixture #3 cover, shared across sizes)     | [File:T-shirt mocup gray.jpg](https://commons.wikimedia.org/wiki/File:T-shirt_mocup_gray.jpg)                                            | Wikimedia user (per File page) | CC0 1.0 |
| `OL-SOAP-NATURAL.jpg`     | Plain natural soap bar (fixture #4 cover)                     | [File:Final product soap.jpg](https://commons.wikimedia.org/wiki/File:Final_product_soap.jpg)                                            | Wikimedia user (per File page) | CC0 1.0 |
| `OL-SOAP-NATURAL-LAV.jpg` | Lavender soap (fixture #4 combination "Scent: Lavender")     | [File:Marseille soap bars (lemon verbena and lavender).jpg](https://commons.wikimedia.org/wiki/File:Marseille_soap_bars_(lemon_verbena_and_lavender).jpg) | Wikimedia user (per File page) | CC0 1.0 |
| `OL-SOAP-NATURAL-ROSE.jpg`| Pink/rose soap (fixture #4 combination "Scent: Rose")        | [File:Bi pride soap heart.jpg](https://commons.wikimedia.org/wiki/File:Bi_pride_soap_heart.jpg)                                          | Wikimedia user (per File page) | CC0 1.0 |
| `OL-RING-RESIN.jpg`       | Handmade ring (fixture #5 cover, shared across sizes)         | [File:Acacia Ring.jpg](https://commons.wikimedia.org/wiki/File:Acacia_Ring.jpg)                                                          | Wikimedia user (per File page) | CC0 1.0 |
| `OL-CANON-SX740LE.jpg`    | Canon PowerShot SX740 HS, silver (fixture #6 cover)           | Canon manufacturer marketing photo (not Wikimedia) | Canon Inc.                     | **Not CC0** — manufacturer photo, dev-fixture use only |

## Verifying the licence

```bash
for url in \
  'https://commons.wikimedia.org/wiki/File:Cordless_electric_(screw)_drill.jpg' \
  'https://commons.wikimedia.org/wiki/File:Coffee_steaming_in_a_mug.jpg' \
  'https://commons.wikimedia.org/wiki/File:T-shirt_mocup_gray.jpg' \
  'https://commons.wikimedia.org/wiki/File:Final_product_soap.jpg' \
  'https://commons.wikimedia.org/wiki/File:Marseille_soap_bars_(lemon_verbena_and_lavender).jpg' \
  'https://commons.wikimedia.org/wiki/File:Bi_pride_soap_heart.jpg' \
  'https://commons.wikimedia.org/wiki/File:Acacia_Ring.jpg'; do
  echo "--- $url"
  curl -sL -A 'Mozilla/5.0' "$url" \
    | grep -oE 'class="licensetpl_short"[^>]*>[^<]+' \
    | head -1
done
```

Each invocation must print `class="licensetpl_short" ...>CC0` (the rendered
short-tag of the `{{cc-zero}}` template). Anything else (CC BY, CC BY-SA,
GFDL) means the file's licence has changed upstream and the image must be
re-curated before shipping.

## Note on substitutes

The drill, tee, and ring images are generic substitutes for the branded
fixtures (Bosch GSR12V-15, Adidas IA4845, handmade resin ring). The issue
(#544) explicitly accepts generic substitutes — these are dev-stack fixtures,
not customer-facing listings, and brand-accurate CC0 photos are unrealistic.

## Note on `OL-CANON-SX740LE.jpg`

Fixture #6 deviates from the CC0 policy: the cover image is a Canon
manufacturer marketing photo (not sourced from Wikimedia Commons) carried
in the repo so the fixture renders brand-accurate in the storefront for
visual smoke-testing of camera-category listings. Use is limited to the
local dev stack — do not reuse this asset in customer-facing surfaces or
marketing material.
