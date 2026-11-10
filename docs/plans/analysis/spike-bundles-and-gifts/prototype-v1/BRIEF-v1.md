# Brief: "Zestawy i gratisy v1, wersja prosta"

App: /tmp/claude-1000/-home-nor-projekty-blocky-openlinker-pnpm-10--claude-worktrees-zestawy-gratisy-rekonesans-c15354/52953735-93f8-46bc-a17f-aa140611c437/scratchpad/spike/app5 (copy of app4: same frame App.tsx, proto.tsx, model/, ui/marks.tsx, ui/documents.tsx, real @web/shared/ui components). Old views in src/views/ stay as reference; you may import their helpers/data but write NEW files `src/views/v1-*.tsx` (+ `v1-*.css` if needed). Each file exports `screen: ScreenDef` like app4 views. Do NOT edit App.tsx, proto.tsx, model/, ui/, views/index.ts (the orchestrator wires the registry).

Goal from the user: keep EVERY function, but make it as simple as possible. Read docs/plans/analysis/spike-bundles-and-gifts/ux-compare/0-synthesis.md (+ the numbered report for your area) and rules-check/0-synthesis.md. Apply the cut list exactly: features stay, complexity goes behind defaults, "Więcej opcji"/"Pokaż szczegóły", automation, tooltips.

Design rules:
- One place per fact. A gift shows once, in its line, with GiftMark; source + who funds it in the tooltip. Bundle = header line with indented components, no "część zestawu" captions.
- "Klient płaci 0,00 zł · Kosztuje Cię X" appears once per gift (order) and once in the promo composer.
- Problems only when there is one: stock path, version, technical keys appear only in error/edge states.
- No jargon in UI: no master, OMS, adapter, routing, ATP, port, wersja v1/v2 (unless an order holds an old composition: "Zamówienie ma skład sprzed zmiany"). Say "w PrestaShop", "przydzielone do pakowania", "dostępne".
- Max 1 status badge + 1 reason in list rows.
- Polish, sentence case, verbs on buttons, same verb in toast. No em dash or en dash anywhere; plain hyphen.
- Who does what (show in state notes, one sentence "Pod spodem:"): the integration (connector) handles platform specifics: reads gift/bundle flags from the channel, writes the gift line to the destination shop, renders the gift on its document (0 zł, grosz, discount line) per what the provider accepts, reads packs/komplety from PrestaShop/Subiekt. OpenLinker does only three generic things: expands a bundle into components for stock/packing, adds gifts from OL promotions to the order, keeps totals equal to what was paid.

States: fewer, but every use case from the old prototype must stay covered. Put spike use-case ids in `useCases` (look them up in the old app4 views for the same situation; ids are in src/uc/*.json). The catalogue screen computes coverage across all screens, so missing ids show as gaps. Include commonStates (loading/error/empty) per screen and a viewer (read-only) state where writes exist.

Verify: type check `cd /home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/zestawy-gratisy-rekonesans-c15354/apps/web && ./node_modules/.bin/tsc --noEmit -p <app5>/tsconfig.json` (other forks' unfinished files may error transiently; fix only yours). Do not build or publish. Report: screen ids, state ids, use cases covered, what you moved behind defaults.
