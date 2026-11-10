---
updatedAt: 2025-09-09T22:36:38.000Z
agentTools:
  projectIndex: https://apidocs.linnworks.net/llms.txt
---

# Endpoint - Products

This call is used to get a list of Channel products for the purpose of mapping. This call is usually scheduled every 12 hours unless a customer requests it to be run sooner.

Quantity is a required field as Linnworks will check this on the product call to ensure the last submitted quantity is the same, if it's not then we will initiate a re-sync.

# Request

<span style={{ backgroundColor: "#0272d9", color: "white", padding: "4px 8px", textAlign: "center", borderRadius: "5px", fontSize: "small" }}>POST</span>

## `ProductsRequest`

| Field Name             |   Type   | Description                                               |
| ---------------------- | :------: | --------------------------------------------------------- |
| **AuthorizationToken** | `String` | Authorization Token from the customers integration.       |
| **PageNumber**         |   `Int`  | Current page number in the fetch sequence, starts from 1. |

## Sample

```json Sample Request
{
  "AuthorizationToken": "0dfdbaf3e4d5434f825e774e31bcc148",
  "PageNumber": 1
}
```

# Response

## `ProductsResponse`

<Table align={[null,"center",null]}>
  <thead>
    <tr>
      <th>
        Field Name
      </th>

      <th>
        Type
      </th>

      <th>
        Description
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        **Error**
      </td>

      <td>
        `String`
      </td>

      <td>
        If there was an error with the request.

        In the cases where there are no products or no more products on the call, return `HasMorePages` as `false` instead of returning an error.
      </td>
    </tr>

    <tr>
      <td>
        **HasMorePages**
      </td>

      <td>
        `Boolean`
      </td>

      <td>
        Indicates if more pages are expected, if true then Linnworks will increment the page call and call again.
      </td>
    </tr>

    <tr>
      <td>
        **Products**
      </td>

      <td>
        `Product[]`
      </td>

      <td>
        Array of products returned from the channel.

        See [Product table.](endpoint-products#product)
      </td>
    </tr>
  </tbody>
</Table>

## `Product`

<Table align={[null,"center",null]}>
  <thead>
    <tr>
      <th>
        Field Name
      </th>

      <th>
        Type
      </th>

      <th>
        Description
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        **SKU**
        _Required_
      </td>

      <td>
        `String`
      </td>

      <td>
        Product Unique SKU, duplicates are not allowed.
      </td>
    </tr>

    <tr>
      <td>
        **Title**
        _Required_
      </td>

      <td>
        `String`
      </td>

      <td>
        Title of the product.
      </td>
    </tr>

    <tr>
      <td>
        **Quantity**
        _Required_
      </td>

      <td>
        `Int`
      </td>

      <td>
        Current quantity / stock level on the channel.
      </td>
    </tr>

    <tr>
      <td>
        **Price**
      </td>

      <td>
        `Decimal`
      </td>

      <td>
        Current price on the channel.
      </td>
    </tr>

    <tr>
      <td>
        **Reference**
        _Required_
      </td>

      <td>
        `String`
      </td>

      <td>
        Reference from the channel e.g. internal product ID. This will be submitted alongside the SKU in inventory and price updates. If there is no reference then supply SKU
        **Limit 64 Chars**
      </td>
    </tr>
  </tbody>
</Table>

## Sample

```json Sample Response
{
	"Error": null,
	"HasMorePages": true,
	"Products": [
		{
			"SKU": "ChannelProduct_1",
			"Title": "Channel Tile of product ChannelProduct_1",
			"Quantity": 68,
			"Price": 9.15,
			"Reference": "12458"
		},
		{
			"SKU": "ChannelProduct_2",
			"Title": "Channel Tile of product ChannelProduct_2",
			"Quantity": 22,
			"Price": 0.99,
			"Reference": "987653"
		}
	]
}
```
```json Sample Response with Error
{
	"Error": "Auth token is not valid.",
	"HasMorePages": true,
	"Products": []
}
```