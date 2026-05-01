# Implementation Plan — #478: useEffect with mutation/form wrapper objects in deps causes infinite render loop

## 1. Goal

Stop the `Maximum update depth exceeded` crash on `/ai/provider-settings` Set/Rotate key click, and bring three sibling sites in line with the same anti-pattern fix.

## 2. Layer

Frontend only. `apps/web/src/features/...`. No backend changes, no schema changes, no migration.

## 3. Non-goals

- New ESLint rule to ban whole-object mutation/form/query in hook deps. Worthwhile, but separate housekeeping PR.
- Refactoring `EditOfferDrawer` / `CreateOfferWizard` away from the `prevIsOpenRef` one-shot pattern. Pattern is fine; only the deps were wrong.
- Sweep beyond `apps/web/src` (no occurrences exist outside it).

## 4. Existing-code baseline

**10 mutation-in-deps call sites**, one actively loops, nine latent:

| File | Line | Hook | Status |
|---|---|---|---|
| `features/ai-provider-settings/components/ai-provider-key-dialog.tsx` | 75-80 | `useEffect` | **Active loop**: `[provider, form, mutation]` + body calls `mutation.reset()`. No one-shot guard. Crashes on dialog open. |
| `features/listings/components/CreateOfferWizard.tsx` | 245-280 | `useEffect` | Latent: `[..., form, mutation]`. Body has `prevIsOpenRef` guard. |
| `features/listings/components/EditOfferDrawer.tsx` | 48-52 | `useCallback` | Latent: `[form, mutation]`. Wrapping `useEffect`'s `prevIsOpenRef` masks it. |
| `features/content/components/suggestion-dialog.tsx` | 52-68 | `useCallback` | Latent: `[..., mutation, ...]`. User-click only. |
| `features/content/components/suggestion-dialog.tsx` | 78-85 | `useCallback` | Latent: `[mutation]`. User-click only. |
| `features/content/components/content-editor.tsx` | 140-149 | `useCallback` | Latent: `[..., publishMutation, ...]`. User-click only. |
| `pages/prompt-templates/prompt-template-detail-page.tsx` | 100-110 | `useCallback` | Latent: `[..., updateMutation, showToast]`. User-click only. |
| `pages/prompt-templates/prompt-template-detail-page.tsx` | 112-121 | `useCallback` | Latent: `[..., publishMutation, showToast]`. User-click only. |
| `pages/prompt-templates/prompt-template-detail-page.tsx` | 123-133 | `useCallback` | Latent: `[..., deleteMutation, showToast, navigate]`. User-click only. |
| `pages/prompt-templates/prompt-template-detail-page.tsx` | 135-150 | `useCallback` | Latent: `[..., createMutation, showToast, navigate]`. User-click only. |

Verified with broader regex (per review IMPORTANT):
```
grep -rnE "}, \[.*[Mm]utation[^.,]*[,\]]" apps/web/src --include="*.tsx" --include="*.ts"
```

The previous narrow regex with `\b(mutation)\b` missed every named mutation (`publishMutation`, `updateMutation`, `deleteMutation`, etc.). Re-sweeping with `[Mm]utation` surfaces them.

### Out of scope: form-only deps

Three additional sites list `form` (RHF `useForm`'s return) in deps without `mutation`:
- `CreateOfferWizard.tsx:315` — `[marketplaceConnections, defaultConnectionId, form]`
- `CreateOfferWizard.tsx:405` — `[currentCategoryId, form]`
- `AllegroSetupForm.tsx:68` — `[autoSelectedConnectionId, form]`

RHF v7+ returns a stable `form` reference, so these don't churn the way TanStack Query's `useMutation` wrapper does. They're not the bug class this PR addresses. If a follow-up sweep wants to tighten them for defensive consistency, that's a separate (small) PR.

`use-media-query.ts:12` — `[query]` is the hook's own `query: string` parameter, not a TanStack Query result. False positive, no action needed.

## 5. Design

Single mechanical fix at every site: replace whole-object hook returns with destructured stable methods.

**Why destructuring is safe**: RHF v7+ documents `form.reset` / `form.setValue` etc. as stable, `this`-free function references — destructuring is the documented pattern. TanStack Query v5's `mutation.mutate` / `mutation.mutateAsync` / `mutation.reset` are likewise stable references that work standalone. The wrapper objects churn; the methods inside don't.

```ts
// before
const mutation = useSomeMutation();
const form = useForm(...);
useEffect(() => { /* uses mutation.reset / form.reset */ }, [..., form, mutation]);

// after
const mutation = useSomeMutation();
const form = useForm(...);
const { reset: resetForm } = form;
const { reset: resetMutation } = mutation;
useEffect(() => { /* uses resetForm / resetMutation */ }, [..., resetForm, resetMutation]);
```

For `suggestion-dialog.tsx` the relevant method is `mutateAsync`, not `reset` — same destructure pattern.

Inline comment at every site explains *why* (TanStack Query wrapper identity churn) so the next reviewer doesn't re-introduce the bug under "fix exhaustive-deps lint warning."

## 6. Step-by-step

Order matters: write the test first (against unfixed code), verify the failure mode, then patch.

| # | File | Action |
|---|---|---|
| 0 | `apps/web/src/features/ai-provider-settings/components/ai-provider-key-dialog.test.tsx` | **New file, written first.** Run against unfixed code and record observed behaviour (fails or forward-guard-only). |
| 1 | `apps/web/src/features/ai-provider-settings/components/ai-provider-key-dialog.tsx` | Destructure `reset` from `form` + `mutation`; update effect deps. |
| 2 | `apps/web/src/features/listings/components/CreateOfferWizard.tsx` | Destructure `reset` from `form` + `mutation`; update effect body + deps. |
| 3 | `apps/web/src/features/listings/components/EditOfferDrawer.tsx` | Destructure `reset` from `form` + `mutation`; update useCallback body + deps. The existing inline comment at the site already flagged the concern but listed the wrong deps — replace it. |
| 4 | `apps/web/src/features/content/components/suggestion-dialog.tsx` (line 68) | Destructure `mutateAsync` from `mutation`; update useCallback body + deps. |
| 5 | `apps/web/src/features/content/components/suggestion-dialog.tsx` (line 85) | Destructure `reset` from `mutation`; update useCallback body + deps. |
| 6 | `apps/web/src/features/content/components/content-editor.tsx` | Destructure `mutateAsync` from `publishMutation`; update useCallback body + deps. |
| 7 | `apps/web/src/pages/prompt-templates/prompt-template-detail-page.tsx` | Destructure `mutateAsync` from `updateMutation`, `publishMutation`, `deleteMutation`, `createMutation`, and `revertMutation` (if present); update each useCallback body + deps. |

## 7. Test cases (new file `ai-provider-key-dialog.test.tsx`)

**Verification protocol (per review BLOCKING)**: write the test against the unfixed file *first*, run it, observe the failure mode. Only then apply the fix and confirm the test passes. This avoids the #461 trap, where a vitest+jsdom regression test passed against broken code and let the bug ship anyway.

If vitest cannot reproduce `Maximum update depth exceeded` (likely — see #461 precedent: the same class of React-19 ref-cleanup loop did not surface in jsdom), the test becomes a **forward-guard only**, with an explicit `// FORWARD-GUARD ONLY (#461 precedent)` comment in the file referencing this gap. Browser-level verification via Chrome DevTools MCP — already done during the bug repro — is the authoritative check, and the PR description records it.

Test cases:

1. `renders the Anthropic key dialog when provider='anthropic' is set` — title `"Set Anthropic API key"` + input + Cancel + Save buttons.
2. `renders the OpenAI key dialog when provider='openai' is set` — same shape, different placeholder.
3. `renders cleanly under React.StrictMode` — wraps the render in `<StrictMode>` to mirror `main.tsx`. Same forward-guard shape as `theme-toggle.test.tsx:138`.
4. `transitions between providers without throwing` — render with `provider='anthropic'`, re-render with `provider='openai'`, assert the title updates.

Existing `ai-provider-settings-page.test.tsx` is untouched and must keep passing.

## 8. Risks

- **None on the fix itself.** Same semantics as before, just stable references.
- **Test fragility on StrictMode**: vitest with React 19 strict-mode renders effects twice. The `useEffect` body is idempotent (re-`reset` on same provider is a no-op). No flakiness expected.

## 9. Quality gate

```bash
pnpm lint && pnpm type-check && pnpm test
```

apps/web's `test` runs vitest. No backend changes → no migration check.

## 10. Acceptance (mirrors issue)

- [ ] Set/Rotate key on `/ai/provider-settings` opens the dialog without throwing.
- [ ] All four sites destructure stable `reset` / `mutateAsync` methods; no `mutation` / `form` / `query` whole-object identity in any hook deps.
- [ ] Regression test in `ai-provider-key-dialog.test.tsx` fails on `main`, passes after fix.
- [ ] `pnpm lint && pnpm type-check && pnpm test` green.
