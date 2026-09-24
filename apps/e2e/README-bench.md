# Pack-bench verification scripts (epic #3401)

Five Playwright scripts that check the pack bench against a running stack.
They are **operator tools, not part of the Playwright suite**: each takes a
whole browser and a real API, so they are run by hand when the bench changes
rather than on every commit.

All of them expect `BASE` (top of each file) to point at a running web
container, and a signed-in-able account.

| Script | Answers |
|---|---|
| `compare-mockup.mjs` | Where does the real screen differ from `docs/plans/mockups/pack-bench-redesign.html`? Prints geometry, type and colour for ~30 elements of both, side by side. Run it after any bench layout change. |
| `compare-responsive.mjs` | Does anything overflow at 1024 / 834 / 768 / 390? Prints every offending element, and screenshots both the mockup and the app at each width. |
| `e2e-bench-mobile.mjs` | The whole packer flow on a phone: sign in, open a box, switch items, **read a barcode with the camera**, watch the box close itself, open the work list over the box. |
| `verify-collision.mjs` | Two packers on one box: does the second one's name reach the first one's collision banner? Needs two accounts. |
| `demo-capture.mjs` | Client-ready screenshots of one real order on phone, tablet and desktop. |

## The camera

Headless Chromium ships **no `BarcodeDetector`**, so the two scripts that
exercise the camera stub the DECODER and nothing else: the fake media device,
`getUserMedia`, the stream in the viewfinder and the read arriving through the
same handler a wedge scanner uses are all real. `window.__nextBarcode` is what
the stub "sees" next, so a script drives WHICH code is read.

This mirrors production more closely than it looks: `BarcodeDetector` is
Chromium-only, so Safari and Firefox get no camera either, and the dock says
so rather than offering a control that cannot work.

## Resetting a box between runs

A run packs the box it opens, so a second run finds nothing to scan. To put
the demo boxes back:

```sql
DELETE FROM fulfillment_work_verifications WHERE "fulfillmentWorkId" IN (...);
UPDATE fulfillment_works
   SET status = 'open', "parcelClosedAt" = NULL, "packedByUserId" = NULL,
       "packedByService" = NULL, version = version + 1
 WHERE id IN (...);
```

The verification LEDGER is what the counts come from - resetting
`fulfillment_work_lines.fulfilledQuantity` alone does nothing.
