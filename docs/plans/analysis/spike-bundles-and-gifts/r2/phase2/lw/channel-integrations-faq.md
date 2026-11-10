---
updatedAt: 2025-09-15T19:58:23.000Z
agentTools:
  projectIndex: https://apidocs.linnworks.net/llms.txt
---

# FAQ

## Can a customer integrate a channel multiple times under the same application?

Yes. The seller will install the application once however they can integrate multiple instances of the channel.

There is no restriction on how many and no mechanism to limit the customer to one instance.

## Who is the source of truth? Channel or Linnworks?

Linnworks is the source of truth for actions and therefore the integration flows have been implemented as such. Any actions such as updating inventory, dispatch, orders, cancellations, refunds, etc. should all be actions in Linnworks.

This is common for sellers as their users often do not have access to the marketplace and expect their users to manage all actions from Linnworks.

## How soon after the customer installs the application will Linnworks start sending requests?

Requests will start when a user integrates the channel which may happen independently to the app install.

Commonly, a user will integrate the channel straight away, configure and link all their items and only then enable. Time frames can vary but usually it would be within the same day that orders, inventory etc would be enabled for download.

<br />

## When testing I've installed the application but not received a notification to the Add new user endpoint, what do I do?

The [add new user endpoint](https://apidocs.linnworks.net/update/docs/channel-integration-endpoint-add-new-user-endpoint) is only executed when the integrate button is pressed after installing the application. After Linnworks has a response from the add new user endpoint it will immediately call the user config endpoint to get the first wizard step.