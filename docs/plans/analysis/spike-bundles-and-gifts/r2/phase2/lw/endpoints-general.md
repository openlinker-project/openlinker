---
updatedAt: 2025-09-09T21:29:35.000Z
agentTools:
  projectIndex: https://apidocs.linnworks.net/llms.txt
---

# Channel Endpoints Overview

While the structure of the URL for the API endpoints doesn’t have to conform to any structure, the requests and responses conform to a strict object structure.

Firstly, each endpoint must respond within 10 seconds of a request otherwise the connection will be disconnected. You must choose an appropriate batch size for updates and ensure that when providing data it is done quickly and efficiently.

All requests sent and received are expected to be in JSON format. All endpoints apart from **[AddNewUserEndpoint](https://apidocs.linnworks.net/docs/add-new-user-endpoint)** will send the **AuthorizationToken** along with the request object.

If an endpoint is set for **[OAuthAuthorizationEndpoint](https://apidocs.linnworks.net/docs/endpoint-oauthauthorization)**, a bearer access token will be requested from this using "client\_credentials" as a grant type with the `client_id` and `client_secret` set on installation. Any scopes set in **OAuthScopesRequested** will be sent in this request. Once received, this will be included in all calls in the Authorization Header as "Bearer \[accesstoken]"

All responses should return content-length. Streaming data is not supported. When you want to ignore one of your endpoints, send default response with no items in the response array, but with response code 200.

## Basic functionality

By default Linnworks expects the following endpoints to be implemented, if an endpoint cannot be implemented then return success and ensure documentation for the marketplace clearly states the function is not supported.

* Add New User
  * Implemented when a user adds the channel
* User Config
  * Manages integration wizard and user config
* Save Config
  * Manages updates to wizard and user config
* Shipping Tags
  * Manages shipping tags so that users can map the channel shipping tags to their Linnworks services.
* Payment Tags
  * Manages shipping tags so that users can map the channel payment tags to their Linnworks payment methods.
* Config Deleted
  * When a user deletes their integration.
* Config Test
  * Used to verify the user config is correct.
* Orders
  * Used to return orders from the channel (marketplace/website) to Linnworks
* Despatch
  * Linnworks will send tracking and shipment information for orders that have been shipped in Linnworks
* Products
  * Used for Linnworks / the customer to know what Listings are already Listed on the marketplace.
* Inventory Update
  * When inventory changes happen in Linnworks these will be sent across to the marketplace.

<br />

## Listing Management

Where the channel requires listing implementation please see the [Listings on a Channel Integration](https://apidocs.linnworks.net/docs/listings-on-a-channel-integration) guide.