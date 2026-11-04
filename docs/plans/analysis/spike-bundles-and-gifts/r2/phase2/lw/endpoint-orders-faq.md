---
updatedAt: 2025-09-15T09:34:18.000Z
agentTools:
  projectIndex: https://apidocs.linnworks.net/llms.txt
---

# FAQ

## Can I send shipped orders though this endpoint

Shipped orders should be filtered from this endpoint as it may risk a seller shipping an order that has already been sent to the customer.

## What happens if a seller processes the order on the marketplace?

Linnworks is the source of truth when it comes to these actions and therefore sellers are advised against doing this action. Linnworks will not automatically process the order in Linnworks and doesn't have a mechanism for doing so.

## The order has updated on the marketplace but the changes haven't been reflected in Linnworks even though we've provided the order again?

Linnworks is the source of truth and once an order is paid there are many actions and processes which can happen immediately therefore updating orders once they are paid is restricted. There are no work arounds for this process.

An example of this would be updating Address information, if the seller had already printed and packed the order in Linnworks and the address changed it would have gone too far down the line to make a change and therefore the order would go to the original address.

The only changes we would accept is if the order status or line status has been marked as cancelled we will cancel the order or line in Linnworks. We only accept line level cancellations.