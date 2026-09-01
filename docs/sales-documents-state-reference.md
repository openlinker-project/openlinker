# Sales document states, and what to do about each one

Every order shows the state of its sales document: on the order row, and in full on the order itself. This page lists every state you can see, what it means, and what to do.

The two document kinds have different states, because they are different things. An **invoice** is issued by OpenLinker and then answered by the tax authority, so it has two states at once. A **fiscal receipt** is registered on a fiscal device and that is the end of it, so it has one.

> How a document kind is chosen: see [How OpenLinker decides](./sales-documents-how-routing-decides.md).
> Setting a market up: see [Setting up a market](./sales-documents-setting-up-a-market.md).

## The one you should read first

**Unconfirmed** is the state that costs the most if you act on it wrongly.

It means the provider took the sale and never answered, so OpenLinker genuinely does not know whether a receipt was created. Registering again could create a **second real fiscal receipt** for one sale. Nothing will happen on its own, deliberately.

**What to do:** ask the provider what it has, using *Check with the provider* on the order. Do not register again first.

A check comes back one of four ways: the provider confirms a receipt, says it holds nothing for this sale, says it holds the sale but has not registered it, or cannot be asked about this sale at all. Failing to reach the provider is a fifth outcome, and is not an answer about the sale. Retry it.

Only a confirmation changes anything. In every other case the order is left exactly where it was, and you can check again later.

## Fiscal receipt

| State | What it means | Waiting on you? | What to do |
|---|---|---|---|
| **Not registered** | Nothing has been sent yet | Yes, if the provider issues on request | Register it, or leave it if it issues automatically |
| **Queued** | The request exists but has not been sent | No | Nothing. It will be sent |
| **Registering** | Sent, waiting for the provider to answer | No | Wait. See the note below about keeping the page open |
| **Registered** | Done. The receipt exists | No | Nothing. This is final |
| **Rejected** | The provider refused. **Nothing was created** | Yes | Fix what it reported, then register again. This is safe |
| **Unconfirmed** | We do not know whether a receipt exists | Yes | Check with the provider. Do **not** register again |

Two things to know about a fiscal receipt:

- **A registered receipt is final.** You cannot correct or cancel it in OpenLinker. That is done at the fiscal device.
- **Rejected and Unconfirmed are not the same.** Rejected means nothing was created, so trying again is safe. Unconfirmed means we do not know, so trying again risks a second receipt.

**While it says Registering**, keep the order page open until it answers. Closing the page stops the request, and nobody will then know whether a receipt was created: the order will read Unconfirmed until someone checks with the provider. This changes once registration runs in the background; the page will say so when it does.

## Invoice

An invoice has a state of its own, and separately an answer from the tax authority.

### The document

| State | What it means | Waiting on you? | What to do |
|---|---|---|---|
| **Not issued** | Nothing has been issued yet | Yes, if the provider issues on request | Issue it, or leave it if it issues automatically |
| **Pending** | Queued at the provider | No | Nothing |
| **Issuing** | Being created right now | No | Wait |
| **Issued** | The invoice exists and is numbered | No | Nothing, unless the authority answer below needs attention |
| **Failed** | The provider refused | Yes | Read the reason, fix it, issue again |
| **Needs review** | We cannot confirm whether it was created | Yes | Check with the provider before issuing again |

### The authority answer

| State | What it means | Waiting on you? | What to do |
|---|---|---|---|
| **N/A** | This provider has no authority step at all | No | Nothing. Not every invoice provider has one |
| **Awaiting submission** | Issued, not yet sent to the authority | No | Nothing |
| **Submitted** | Sent, no answer yet | No | Nothing. OpenLinker keeps checking |
| **Clearing** | The authority is processing it | No | Nothing |
| **Accepted** | The authority accepted it. Fully done | No | Nothing |
| **Rejected** | The authority refused it | Yes | Read the reason, fix it, then send it again |

An invoice can be **Issued** and **Rejected** at the same time: the document exists in OpenLinker, and the authority has not accepted it. Both facts are true and both are shown.

**A correction is a new document**, linked to the original. It does not replace it. Unless the problem is the invoice content itself, wait for the authority's answer before correcting.

## When nothing has been issued, and it is not waiting on the provider

These states mean OpenLinker chose not to issue, and each one has a different fix.

| State | What it means | What to do |
|---|---|---|
| **Issued on request** | This provider only issues when you ask. Nothing is wrong | Issue it when you are ready, or change when the provider issues |
| **Waiting for the batch** | This connection is set to issue in batches, and OpenLinker does not collect batches yet, so nothing will pick this order up on its own | Issue it by hand, or set the connection to issue automatically |
| **Tax rate missing** | A line has no tax rate. Nothing is guessed | Set the rate in your shop catalogue, then try again |
| **No routing** | Routing could not decide what this order needs | See [How OpenLinker decides](./sales-documents-how-routing-decides.md) |
| **Provider offline** | The provider's connection needs signing in again | Reconnect it. The order waits; it is not moved to another provider |

**Not yet reachable.** *No buyer tax ID* is defined but nothing writes it today: OpenLinker now carries the buyer's tax ID on an order, but no check refuses a document for the lack of one, so you will not see this state until one does.

**A tax rate disagreement does not hold anything.** If your shop and the sales channel report different rates for a line, the shop's rate is used, the document issues, and the difference is shown on the order as its own note. It is not one of the states above.

**Issued on request is a setting, not a problem.** If that is how you work, those orders are not errors and are not counted as needing attention. They are listed separately so you can work through them.

## Two things that are never claimed

- **Nothing here says a document was emailed or delivered to the buyer.** No provider reports that back, so OpenLinker does not claim it.
- **A fiscal receipt never shows an authority answer.** It has no such step. If you see one, it is an invoice.
