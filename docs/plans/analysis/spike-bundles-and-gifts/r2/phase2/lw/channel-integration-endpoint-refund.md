---
updatedAt: 2025-09-09T22:36:22.000Z
agentTools:
  projectIndex: https://apidocs.linnworks.net/llms.txt
---

# Endpoint - Refund

Endpoint which is called with details of an order refund within Linnworks.

This endpoint is used when the customer refunds an order in Linnworks.net.

# Request

<span style={{ backgroundColor: "#0272d9", color: "white", padding: "4px 8px", textAlign: "center", borderRadius: "5px", fontSize: "small" }}>POST</span>

## `OrderRefundRequest`

| Field Name             |      Type     | Description                                                                                 |
| ---------------------- | :-----------: | ------------------------------------------------------------------------------------------- |
| **AuthorizationToken** |    `String`   | Authorization Token from the customers integration.                                         |
| **Refund**             | `OrderRefund` | Information about the order/items to refund. See [OrderRefund](endpoint-refund#orderrefund) |

## `OrderRefund`

| Field Name               |         Type        | Description                                                                                                      |
| ------------------------ | :-----------------: | ---------------------------------------------------------------------------------------------------------------- |
| **Items**                | `OrderRefundItem[]` | A collection of order items to refund on the marketplace. See [OrderRefundItem](endpoint-refund#orderrefunditem) |
| **ReferenceNumber**      |       `String`      | The order reference number within Linnworks.                                                                     |
| **ExternalReference**    |       `String`      | The external reference number within Linnworks. This is usually the marketplace reference.                       |
| **RefundShippingAmount** |      `Decimal`      | The amount to refund for shipping.                                                                               |

## `OrderRefundItem`

| Field Name          |    Type   | Description                                                                                                                                                               |
| ------------------- | :-------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SKU**             |  `String` | The unique Linnworks SKU of the item.                                                                                                                                     |
| **OrderLineNumber** |  `String` | The order item number for this item. This is usually the marketplace ID for the order item.                                                                               |
| **RefundAmount**    | `Decimal` | The amount to submit as a refund for this item.                                                                                                                           |
| **Reason**          |  `String` | If the marketplace supports tag-based refund reasons, this field will contain the selected tag. Otherwise, it will include the freetext reason submitted by the customer. |
| **SecondaryReason** |  `String` | If the marketplace supports tag-based refund reasons, this field will contain the selected sub-tag.                                                                       |

## Sample

```json Sample Request
{
  "AuthorizationToken": "0dfdbaf3e4d5434f825e774e31bcc148",
  "Refund": {
    "ReferenceNumber": "XYZ-1",
    "ExternalReference": "EXT-XYZ-1",
    "RefundShippingAmount": 0,
    "Items": [
      {
        "OrderLineNumber": "010045",
        "SKU": "ITEM-001",
        "RefundAmount": 49.99,
        "Reason": "Broken",
        "SecondaryReason": ""
      }
    ]
  }
}
```

# Response

## `OrderRefundResponse`

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
        **RefundReference**
        _Required_
      </td>

      <td>
        `String`
      </td>

      <td>
        Returns the created refund reference from the marketplace.
      </td>
    </tr>

    <tr>
      <td>
        **Error**
      </td>

      <td>
        `String`
      </td>

      <td>
        Defines if there was an error with the request and returns it.
      </td>
    </tr>
  </tbody>
</Table>

## Sample

```json Sample Response
{
  "RefundReference": "REF-001"
}
```
```json Sample Response with Error
{
  "Error": "Could not process refund.",
  "RefundReference": "REF-001"
}
```