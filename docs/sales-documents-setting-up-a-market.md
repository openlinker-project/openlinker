# Setting up a market

A fresh OpenLinker issues no sales documents at all. That is deliberate: which document a sale owes is a question about your business and your tax obligations, so nobody but you can answer it.

This page gets you from an empty setup to one that issues documents.

> Why an order got the document it got: see [How OpenLinker decides](./sales-documents-how-routing-decides.md).
> What a state on an order means: see [Sales document states](./sales-documents-state-reference.md).

Everything below happens on **Settings → Sales documents**.

## What a market is

A market is a country your orders are billed to, plus your decision about what a sale there gets.

There is also one special market, **Rest of world**, used for any country you have not set up. It behaves like any other market, and is reached only by countries that have no setup of their own.

## Step 1: see which markets you actually need

You do not have to guess. OpenLinker knows which countries your orders are billed to, so any country that orders arrive from appears in the market list with a count, whether or not you have set it up:

> **Poland** · PL · not set up
> Nothing · 47 orders billed here in the last 30 days

A market listed like this is **not an error**. It means nobody has made a decision about it yet. Nothing is lost while it waits: no document is created, and one will be as soon as the market can answer.

Start with the markets that have the most orders.

## Step 2: connect a provider, and say what it issues

A market can only issue what one of your connections can produce. Under **Connected providers**, each connection has three settings:

- **Issues**: invoice, fiscal receipt, or nothing. A connection set to *nothing* is never chosen, so this is the first thing to set.
- **Goes first**: only one connection across all of them may go first, whatever it issues.
- **Issues when**: on request, in a batch, when the order is paid, or when it ships. *On request* means nothing happens until you press the button, which is a valid way to work.

A connection that needs signing in again cannot issue anything, and says so.

## Step 3: choose a rule or a default

For each market you have two tools.

**A default** is the simple case: *everything from this country gets this document from this provider.* If one document covers every sale in a market, set one default and stop.

**A rule** is for when it depends: *when these things are true, issue this instead.* Use a rule when some sales in a market need a different document from the rest.

Two limits to know before you start:

- **Only one default may apply per market.** If you set both an invoice default and a receipt default, neither is used, and every order that matches no rule is held. If you need both documents in one market, the choice between them has to come from a rule.
- **Only one rule may match an order.** Rules have no priority, so if two match, the order is held rather than one winning. Keep conditions narrow enough that they cannot overlap.

## Step 4: check what the market now issues

The market list states what an order billed there gets today, worked out the same way as when a document is issued. Read it back before you move on:

> **Germany** · DE
> Invoice from Ksef Demo · Set by the default

If it says **Nothing**, the short reason is next to it, and [How OpenLinker decides](./sales-documents-how-routing-decides.md) has the fix for each one.

## A market that should issue nothing

Some markets genuinely need no document from OpenLinker. Say so explicitly, using the *no document by choice* setting on the market.

This matters because otherwise that market looks identical to one nobody has configured, and it will keep drawing your attention forever.

## Suggested setups

Where we have researched public guidance for a market, the market offers a suggested setup you can read before adopting. Nothing is applied until you adopt it, and nothing is ever adopted automatically.

**Today Poland is the only market with any guidance.** A market without one simply gets a plain *set up*, and that is not a hint that something is missing on your side.

### Before you adopt the Poland template

The Poland template contains three rules. All three ask **whether the buyer gave a tax ID**, and OpenLinker does not record that on any order yet.

A rule that asks about something unknown can never match. So if you adopt the template as it stands, all three rules are inactive, and what actually happens is whatever the default step says: one default set, that document is issued; both set, every order is held; neither set, the order falls to Rest of world.

The market page marks these rules as unable to match. The template is still worth reading, because it shows the shape a Polish setup takes and cites its source, but treat it as a starting point rather than a working configuration, and set a single default alongside it so orders are not held while the rules are dormant.

None of this is legal advice. Review any suggested setup with your accountant before relying on it.

## When you are done

- Every market that receives orders has a decision: a document, or *no document by choice*.
- **Rest of world** has a default, or you have accepted that orders from anywhere else are held.
- Each market's line reads back what you expect.
