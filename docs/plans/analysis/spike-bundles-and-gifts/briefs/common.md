# Common brief (all research agents, rounds 3-5)

## Product
OpenLinker is an open-source OMS / e-commerce orchestration platform (hexagonal NestJS monorepo; core in libs/core/src/<context>, adapters in libs/integrations/<platform>, first-party OMS in libs/oms, web in apps/web). Polish market first, but core must stay country-agnostic (no national vocabulary or tax rules in core). It ingests orders from marketplaces (Allegro, Erli, Amazon, Kaufland, Empik) and shops (PrestaShop, WooCommerce, Shoper, IdoSell), reserves stock in the product master, routes and packs parcels on a pack bench, and issues invoices and fiscal receipts (KSeF, inFakt, eparagony e-receipts via a Novitus printer, Subiekt GT/nexo via a bridge).

We are designing **bundles/kits/sets ("zestawy")** and **free gifts ("gratisy")** as ONE neutral standard that each integration adapter maps onto (neutral order-line fields + adapter-declared capabilities on ports).

## Evidence rules (strict)
- Every factual claim needs evidence: a URL **plus a short verbatim quote** from the source, or `file:line` for code, or a reproducible live test you ran. No evidence = write it as (unverified) and never let it carry a conclusion.
- Prefer primary sources (API specs, source code, official docs/changelogs) over blogs, vendor marketing and forums. Say which kind each source is.
- If sources conflict, report both and say which you trust and why.
- Ratings vocabulary for coverage: Full / Partial / None / Unknown. "Unknown" is allowed and better than a guess.
- Be critical. If something sounds too clean, look for the counterexample.

## Output rules
- Save your FULL report as markdown with a Bash heredoc to the exact path given in your task (inside docs/plans/analysis/spike-bundles-and-gifts/). Never write anywhere else. Do not edit any other repository file, do not commit, do not touch GitHub, do not sign up or contact anyone.
- Return a condensed version (max ~80 lines) in the format your task asks for.
