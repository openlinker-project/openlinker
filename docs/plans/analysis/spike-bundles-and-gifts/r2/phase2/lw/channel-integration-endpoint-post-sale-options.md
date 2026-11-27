---
updatedAt: 2026-06-19T09:22:25.000Z
agentTools:
  projectIndex: https://apidocs.linnworks.net/llms.txt
---

# Endpoint - Post Sale Options

This call is made when creating an RMA or refund request for orders from this channel. It allows you to determine what kinds of refunds and returns are supported on the channel, so that the UI is presented accordingly.

> 📘 If you provide any reasons, you must provide a reason for all supported post sale actions.

# Request

<span style={{ backgroundColor: "#0272d9", color: "white", padding: "4px 8px", textAlign: "center", borderRadius: "5px", fontSize: "small" }}>POST</span>

## `GetPostSaleOptionsRequest`

| Field Name             |   Type   | Description                                         |
| ---------------------- | :------: | --------------------------------------------------- |
| **AuthorizationToken** | `String` | Authorization Token from the customers integration. |

## Sample

```json Sample Request
{
  "AuthorizationToken": "0dfdbaf3e4d5434f825e774e31bcc148"
}
```

# Response

## `GetPostSaleOptionsResponse`

| Field Name                         | Type                 | Description                                                                                          |
| :--------------------------------- | :------------------- | :--------------------------------------------------------------------------------------------------- |
| **Error**                          | `String`             | If there was an error with the product update.                                                       |
| **CanCancel**                      | `Boolean`            | Determines whether the channel allows cancelling an order.                                           |
| **CanCancelOrderLines**            | `Boolean`            | Determines whether the channel allows cancelling individual order lines.                             |
| **CanCancelOrderLinesPartially**   | `Boolean`            | Determines whether the channel allows cancelling only part of an order line (not the full quantity). |
| **AutomaticRefundOnCancel**        | `Boolean`            | Determines whether the channel will automatically refund an order when it is cancelled.              |
| **CanRefund**                      | `Boolean`            | Determines whether the channel allows refunding an order.                                            |
| **CanAttachRefundToItem**          | `Boolean`            | Determines whether the channel allows attaching refunds to a particular order line.                  |
| **CanAttachRefundToService**       | `Boolean`            | Determines whether the channel allows attaching refunds to service lines.                            |
| **RefundShippingTypes** *Required* | `ShippingRefundType` | Determines how the channel deals with shipping refunds.                                              |
| **CanRefundAdditionally**          | `Boolean`            | Determines whether the channel allows creating refunds independent of any items/shipping.            |
| **CanReturn**                      | `Boolean`            | Determines whether the channel allows creating returns.                                              |
| **PostSaleReasons** *Required*     | `PostSaleReasons[]`  | Provides a list of reasons for post-sale actions.                                                    |

## `ShippingRefundType (Flagged Enum)`

| Flag             | Numeric Value | Description                                                   |
| ---------------- | ------------- | ------------------------------------------------------------- |
| **NotSupported** | `0`           | Shipping refunds are not supported.                           |
| **TiedToItem**   | `1`           | Shipping refunds are only supported when attached to an item. |
| **Independent**  | `2`           | Shipping refunds are supported as independent refunds.        |

## `PostSaleReasons`

| Field Name                 | Type                  | Description                                                                                                                                   |
| :------------------------- | :-------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tag** *Required*         | `String`              | Value used when submitting to the channel, e.g. OrderedWrongSize.                                                                             |
| **DisplayName** *Required* | `String`              | A user-readable version of Tag, displayed to the user, e.g. Ordered Wrong Size.                                                               |
| **Types** *Required*       | `ChannelReasonType[]` | The action this reason relates to, e.g. is this a reason for cancelling an order, or is it a reason for refunding shipping cost, or both etc. |
| **SubReasons**             | `SubReason[]`         | Any subreasons for the reason.                                                                                                                |

## `ChannelReasonType`

| Type                 | Numeric Value | Description                                                         |
| -------------------- | ------------- | ------------------------------------------------------------------- |
| **Cancellation**     | `0`           | The reason is used when cancelling an order.                        |
| **ItemRefund**       | `1`           | The reason can be used as a reason for refunding an item.           |
| **ShippingRefund**   | `2`           | The reason can be used as a reason for refunding the shipping cost. |
| **ServiceRefund**    | `3`           | The reason can be used as a reason for refunding a service item.    |
| **AdditionalRefund** | `4`           | The reason can be used for any additional refunds made.             |

## `SubReason`

| Field Name                 | Type     | Description                                            |
| :------------------------- | :------- | :----------------------------------------------------- |
| **Tag** *Required*         | `String` | Value used when submitting to the channel.             |
| **DisplayName** *Required* | `String` | A user-readable version of Tag, displayed to the user. |

## Sample

```json Sample Response
{
  "Error": null,
  "CanCancel": true,
  "CanCancelOrderLines": true,
  "CanCancelOrderLinesPartially": true,
  "AutomaticRefundOnCancel": false,
  "CanRefund": true,
  "CanAttachRefundToItem": true,
  "CanAttachRefundToService": false,
  "RefundShippingTypes": 0,
  "CanRefundAdditionally": false,
  "CanReturn": false
}
```