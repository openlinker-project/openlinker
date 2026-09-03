# How OpenLinker decides which document a sale gets

Every sale needs a document: either an **invoice** or a **fiscal receipt**. OpenLinker does not decide which one your business owes. You set that up per market, and OpenLinker follows what you set.

This page explains how it follows it, so you can work out why any given order got the document it got, or why it got none.

> Setting a market up for the first time: see [Setting up a market](./sales-documents-setting-up-a-market.md).
> What a state on an order means: see [Sales document states](./sales-documents-state-reference.md).
>
> This page describes the routing settings and screens that ship with the #2513 redesign, which is proposed but has no code yet — see `docs/architecture-overview.md § 17. Sales Documents`. Today's routing is the simpler operator-configured model this page's own "not yet distinguished" notes point to.

## The short version

For each order, OpenLinker looks at the country the order is delivered to, and then works through four steps in order. The first one that produces an answer wins.

1. **Your rules for that country.** Exactly one must match.
2. **That country's default**, if no rule matched. Exactly one default may apply.
3. **Rest of world**, but only if that country has no rules and no default at all.
4. **Nothing.** The order is held, and the reason is shown on the order.

An order that is held is not lost. Nothing is issued, nothing is sent anywhere, and it will be issued as soon as the setup can answer.

## Step 1: your rules

A rule says: *when these things are true, issue this document through this provider.*

All of a rule's conditions must be true for it to match. If several conditions are listed, they all apply, not any of them.

Two things about rules surprise people, so they are worth stating plainly.

**Exactly one rule must match.** Rules have no order and no priority. If two rules both match an order, OpenLinker does not pick the first, the newest, or the most specific one. It holds the order and tells you two rules matched. This is deliberate: for a tax document, picking one at random would be worse than waiting for you.

So if you see *Two rules matched*, narrow the conditions until only one can apply to that kind of order.

**A rule that asks about something OpenLinker does not know can never match.** If a condition reads a fact that is not recorded on your orders, the answer is neither yes nor no, so the rule simply never fires. The market page reports how many of your rules read such a fact.

This is not a hypothetical, but it is only partly true today. The starter rules for Poland all ask whether the buyer gave a tax ID. OpenLinker records that fact only when the order's source reports it — today, that means PrestaShop. An order from a source that asserts nothing about it, such as Allegro or WooCommerce, leaves the condition neither true nor false, so the rule does not fire for that order. Adopt the template as it stands and it is live for your PrestaShop-sourced orders and dormant for the rest, depending on your own mix of connections — the market page reports how many of your rules read the buyer's tax ID, so you can judge whether the gap matters for you.

## Step 2: the country's default

If no rule matched, the default for that country applies. A default says: *anything not covered by a rule gets this document from this provider.*

**Only one default may apply.** You can set an invoice default and a receipt default separately, and if you set **both**, the default step cannot choose between them, so it does nothing. Every order that matches no rule is then held.

This is the single most common way a market ends up issuing nothing while looking configured. If a market shows *Two defaults set*, remove one, or add a rule that decides between them.

> **Not yet distinguished.** Today this case shares its reason with *Two rules matched* and with a connection-level ambiguity, and the short explanation an order carries can name connections rather than defaults. Telling the two apart, so the order states which one it hit, is part of the work that builds these screens.

## Step 3: Rest of world

**Rest of world** is a fallback market for countries you have not set up.

It is reached only by a country that has **no rules and no default of its own**. A country you have configured never falls through to it: if that country's rules and default produce no answer, the order is held there.

That distinction matters when you are debugging. Setting up Rest of world does not rescue a configured market that is not working.

## Step 4: nothing

If nothing above produced an answer, the order is held and the reason is recorded on it. You will see the reason on the order row and on the order itself, and the market page shows the same reason for the market as a whole.

## Working out what happened to one order

Open the order. The sales document panel states which document routing chose and which provider will issue it, or, if nothing was chosen, why not. **Why this document?** on that panel names the rule or default that decided it.

If nothing was chosen, the reason is one of these:

| Reason | What it means | What to do |
|---|---|---|
| No rule matched | The market has routing, but nothing matched this order and no single default applies | Add a rule that covers it, or leave exactly one default set |
| Two rules matched | More than one rule fits this order | Narrow the conditions so only one can match |
| Two defaults set | Both an invoice and a receipt default are set, and no rule matched | Set just one, or add a rule that decides |
| No routing anywhere | Neither the country nor Rest of world has anything set | Set up that market, or give Rest of world a default |
| Provider cannot issue this | The chosen provider does not issue that kind of document | Choose a provider that does |
| Order is net-priced | A rule compares the order total, and this order is priced net | Use a condition that does not depend on the total |
| Currency does not match | A rule's limit is in a different currency from the order | Set the limit in the order's currency, or use a different condition |

*Two rules matched* and *Two defaults set* are today recorded under one shared reason, so an order may show the other one's wording until they are told apart.

Amounts are never converted when routing decides. A rule with a limit in one currency does not apply to an order in another.

## Things OpenLinker will never do

- **Guess.** If the setup does not produce exactly one answer, the order waits. A wrong document is a real tax document with the wrong details on it.
- **Issue two documents for one sale.** One order gets one originating document. A correction is a follow-up to an existing one, not a second document.
- **Change your rules.** Nothing is added, adopted or applied without you choosing it.
