---
updatedAt: 2026-09-30T10:53:41.000Z
agentTools:
  projectIndex: https://apidocs.linnworks.net/llms.txt
---

# Endpoint - Orders

This call is made by Linnworks automation to get a list of orders since the last time it requested orders. These calls are made every 10 to 15 minutes usually. The request expects a page result back, if there are a lot of orders to return it is suggested to split the result into pages of 100 maximum.

# Request

<span style={{ backgroundColor: "#0272d9", color: "white", padding: "4px 8px", textAlign: "center", borderRadius: "5px", fontSize: "small" }}>POST</span>

## `OrdersRequest`

| Field Name             |    Type    | Description                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | :--------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AuthorizationToken** |  `String`  | Authorization Token from the customers integration.                                                                                                                                                                                                                                                                         |
| **UTCTimeFrom**        | `DateTime` | Utc date from Linnworks since the last time we had a successful orders request. This may change from Linnworks side if the user want’s to back date the sync. It is suggested that if the channels API has the availability of filtering by the last time the order was updated to use this. Format: `yyyy-MM-dd HH:mm:ssZ` |
| **PageNumber**         |    `Int`   | Page number of the request. Starts from 1.                                                                                                                                                                                                                                                                                  |

## Sample

```json Sample Request
{
  "AuthorizationToken": "f989a881a6a241d5ab81b4b03f3730f1",
  "UTCTimeFrom": "2023-08-26T09:43:14Z",
  "PageNumber": 1
}
```

# Response

## `OrdersResponse`

| Field Name                       |    Type   | Description                                             |
| -------------------------------- | :-------: | ------------------------------------------------------- |
| **Error**                        |  `String` | If there was an error with the request.                 |
| **HasMorePages**<br />*Required* | `Order[]` | Array of orders returned from the call. See Order table |

## `Order`

<Table align={[null,"center",null]}>
  <thead>
    <tr>
      <th>
        Field Name
      </th>

      <th style={{ textAlign: "center" }}>
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
        **BillingAddress**_Conditionally Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `Address`
      </td>

      <td>
        Billing Address of the customer.  If empty then shipping address address must be applied.
        See

        [Address Table.](#address)
      </td>
    </tr>

    <tr>
      <td>
        **DeliveryAddress**_Conditionally Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `Address`
      </td>

      <td>
        Shipping Address of the customer. If empty then billing address must be applied.
        See

        [Address Table.](#address)
      </td>
    </tr>

    <tr>
      <td>
        **OrderItems**_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `OrderItem[]`
      </td>

      <td>
        Array of order items relating to the order.
        See

        [OrderItem Table.](#orderitem)
      </td>
    </tr>

    <tr>
      <td>
        **ExtendedProperty**
      </td>

      <td style={{ textAlign: "center" }}>
        `ExtendedProperty[]`
      </td>

      <td>
        Array of order extended properties relating to the order.
        Names should be unique as they are used as a key.
        See

        [ExtendedProperty table](#extended-property)
      </td>
    </tr>

    <tr>
      <td>
        **Notes**
      </td>

      <td style={{ textAlign: "center" }}>
        `Note[]`
      </td>

      <td>
        Array of order notes relating to the order.
        See

        [Notes table.](#note)
      </td>
    </tr>

    <tr>
      <td>
        **Site**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Site of the order, this is usually used when the channel has one set of credentials however has multiple sites for example UK, DE, US and so on. Leave blank if this is not applicable. This field is used in Postal Service and Payment mapping.
      </td>
    </tr>

    <tr>
      <td>
        **MatchPostalServiceTag**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Shipping tag used which is used for order mapping to map the channel shipping tag to the Linnworks shipping service.
      </td>
    </tr>

    <tr>
      <td>
        **MatchPaymentMethodTag**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Payment tag used which is used for order mapping to map the channel payment tag to the Linnworks payment service.
      </td>
    </tr>

    <tr>
      <td>
        **PaymentStatus**_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Payment status of the order. Valid values:

        `PAID` - The order will be downloaded as a paid order in Linnworks
        `UNPAID` - The order will be downloaded as an unpaid order in Linnworks
        `CANCELLED` - If the order exists in Linnworks, it will be marked as cancelled. If it doesn't exist in Linnworks, it will be ignored
      </td>
    </tr>

    <tr>
      <td>
        **ChannelBuyerName**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Name of the customer who bought the item. If the channel supports usernames it’s suggested to put the username instead of the actual name of the customer.
      </td>
    </tr>

    <tr>
      <td>
        **ReferenceNumber**_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Unique reference of the order. If two orders have the same reference then one will be ignored. This field will be sent back when marking orders as despatched.
      </td>
    </tr>

    <tr>
      <td>
        **ExternalReference**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        External reference is usually the payment gateway transaction id.
      </td>
    </tr>

    <tr>
      <td>
        **Currency**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        3 digit ISO 4217 currency code of the order.
      </td>
    </tr>

    <tr>
      <td>
        **ReceivedDate**_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `DateTime`
      </td>

      <td>
        Date the order was created. Where possible normalize to UTC Format: `yyyy-MM-dd HH:mm:ssZ`.
      </td>
    </tr>

    <tr>
      <td>
        **DispatchBy**
      </td>

      <td style={{ textAlign: "center" }}>
        `DateTime`
      </td>

      <td>
        Date the order should be shipped by. Where possible normalize to UTC Format: `yyyy-MM-dd HH:mm:ssZ`.
      </td>
    </tr>

    <tr>
      <td>
        **PaidOn**
      </td>

      <td style={{ textAlign: "center" }}>
        `DateTime`
      </td>

      <td>
        Date the order was paid. Where possible normalize to UTC Format: ​`yyyy-MM-dd HH:mm:ssZ`.
      </td>
    </tr>

    <tr>
      <td>
        **PostalServiceCost**
      </td>

      <td style={{ textAlign: "center" }}>
        `Decimal`
      </td>

      <td>
        Postal cost of the order including tax.
      </td>
    </tr>

    <tr>
      <td>
        **PostalServiceTaxRate**
      </td>

      <td style={{ textAlign: "center" }}>
        `Decimal`
      </td>

      <td>
        Tax rate used for the postal service.
      </td>
    </tr>

    <tr>
      <td>
        **UseChannelTax**
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        If True Linnworks will not overwrite the PostalServiceTaxRate percentage.
      </td>
    </tr>

    <tr>
      <td>
        **DiscountType**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Discount type of the order. Valid values:

        `AllEvenly` - The given discount amount will be split evenly across all items and any applicable postage.
        `ItemsThenPostage` - The discount amount will be split evenly across all items. Any remaining discount will be applied to the postage where applicable.
        `PostageThenItems` - he discount amount will be applied to the postage cost where applicable. Any remaining discount will be split evenly across all items.
      </td>
    </tr>

    <tr>
      <td>
        **Discount**
      </td>

      <td style={{ textAlign: "center" }}>
        `Decimal`
      </td>

      <td>
        The amount of discount.
      </td>
    </tr>

    <tr>
      <td>
        **MarketplaceTaxId**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Marketplace Tax Id.
      </td>
    </tr>

    <tr>
      <td>
        **BuyerTaxNumber**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Tax number of buyer.
      </td>
    </tr>

    <tr>
      <td>
        **PIIRedactionDays**
      </td>

      <td style={{ textAlign: "center" }}>
        `Short?`
      </td>

      <td>
        Days after order is processed when PII data will get redacted - NULL / Not Supplied will never redact
      </td>
    </tr>

    <tr>
      <td>
        **LocationTag**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Only used for MLI - Provide if location tag is provided from the channel.
      </td>
    </tr>

    <tr>
      <td>
        **OrderFulfilmentType**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Defines who fulfils the order and how Linnworks handles it after download.

        - `Manual`: Default. The order is fulfilled in Linnworks as normal.
        - `POS`: The order comes from a point-of-sale source (for example, an in-store sale).
        - `DigitalOnly`: The order has digital items only. Nothing ships.
        - `FulfilmentByChannel`: The channel fulfils the order (for example, a marketplace warehouse).
      </td>
    </tr>

    <tr>
      <td>
        **OrderStatus**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Defines the state of the order on the channel.

        - `Unknown`: Not set. Linnworks ignores the value and keeps its default.
        - `Pending`: Order is not ready to process.
        - `Unshipped`: Order is ready to ship.
        - `PartiallyShipped`: Some items shipped.
        - `Shipped`: All items shipped. Linnworks can mark the order as processed on download.
        - `PartiallyCancelled`: Some items cancelled.
        - `Cancelled`: Order cancelled.
        - `PartiallyRefunded`: Some items refunded.
        - `Refunded`: Order refunded.
      </td>
    </tr>
  </tbody>
</Table>

## `Address`

| Field Name       |   Type   | Description                    |
| ---------------- | :------: | ------------------------------ |
| **FullName**     | `String` | Customer Full Name.            |
| **Company**      | `String` | Customer Company.              |
| **Address1**     | `String` | First line of address.         |
| **Address2**     | `String` | Second line of address.        |
| **Address3**     | `String` | Third line of address.         |
| **Town**         | `String` | Town.                          |
| **Region**       | `String` | Area, County, State or Region. |
| **PostCode**     | `String` | Postal / Zip Code.             |
| **Country**      | `String` | Country                        |
| **CountryCode**  | `String` | ISO 3166-2 Country Code.       |
| **PhoneNumber**  | `String` | Customer's phone number.       |
| **EmailAddress** | `String` | Email Address.                 |

## `OrderItem`

<Table align={[null,"center",null]}>
  <thead>
    <tr>
      <th>
        Field Name
      </th>

      <th style={{ textAlign: "center" }}>
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
        **TaxCostInclusive**
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Indicates if the line item is tax cost exclusive or not
        `True` - The line is tax cost **inclusive**`False` - The line is tax cost **exclusive**
      </td>
    </tr>

    <tr>
      <td>
        **UseChannelTax**
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Indicates if the order should used channel provided tax information or should use Linnworks calculated tax. This can be used in case the channel doesn't provide any tax information.
        `True` - We will use the channel provided tax figures
        `False` - We will ignore the channel provided tax figures and use the customers tax settings in Linnworks.
      </td>
    </tr>

    <tr>
      <td>
        **IsService**
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Indicates if the line item is a service or a real product.
        `True` - The item is a service and when the order is saved it will create a order line service that is not linked to a Linnworks SKU.
        `False` -The item is a real product and therefore will be linked to a Linnworks SKU if a match is found.
      </td>
    </tr>

    <tr>
      <td>
        **OrderLineNumber**_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Unique per order line number.

        Any orders with non unique or duplicates will not be saved.
      </td>
    </tr>

    <tr>
      <td>
        **SKU**_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        SKU of the product (used for Mapping).

        Must not be empty.
      </td>
    </tr>

    <tr>
      <td>
        **PricePerUnit**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Individual price per unit.
      </td>
    </tr>

    <tr>
      <td>
        **Qty**_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Quantity ordered, must be greater than zero.
      </td>
    </tr>

    <tr>
      <td>
        **TaxRate**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Tax rate of the product.
      </td>
    </tr>

    <tr>
      <td>
        **LinePercentDiscount**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Percentage line discount.
      </td>
    </tr>

    <tr>
      <td>
        **ItemTitle**_Conditionally Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Title of the product.
        Required when **IsService**is true
        Item title must be unique across all service items.
      </td>
    </tr>

    <tr>
      <td>
        **Options**
      </td>

      <td style={{ textAlign: "center" }}>
        `OrderItemOption[]`
      </td>

      <td>
        Order item options, usually used for customizations.

        Name must not exist multiple times as it's used as a key.
        See [OrderItemOption](#orderitemoption) Table.
      </td>
    </tr>

    <tr>
      <td>
        **CancelStatus**
      </td>

      <td style={{ textAlign: "center" }}>
        `     `String\`\`
      </td>

      <td>
        Cancellation status of the line item. Valid values:

        `NONE` - The order item will be downloaded into Linnworks.
        `CANCELLED` - If the order item exists in Linnworks, it will be split into a new order and cancelled. If all items are marked as cancelled it will cancel the original order. If it doesn't exist in Linnworks, it will be ignored.

        Currently only whole lines can be cancelled. Cancellation of partial line quantities is not supported.
      </td>
    </tr>
  </tbody>
</Table>

## `OrderItemOption`

| Field Name                |   Type   | Description                   |
| ------------------------- | :------: | ----------------------------- |
| **Name**<br />*Required*  | `String` | Unique per order option Name. |
| **Value**<br />*Required* | `String` | Option Value.                 |

## `Extended Property`

| Field Name                |   Type   | Description                                                 |
| ------------------------- | :------: | ----------------------------------------------------------- |
| **Name**<br />*Required*  | `String` | Unique per order option Name.                               |
| **Value**<br />*Required* | `String` | Property value.                                             |
| **Type**<br />*Required*  | `String` | Type of property for example "Shipping", "Tracking Number". |

## `Note`

| Field Name                        |    Type    | Description                                                                                                     |
| --------------------------------- | :--------: | --------------------------------------------------------------------------------------------------------------- |
| **Note**<br />*Required*          |  `String`  | Note text, duplicates will be ignored.                                                                          |
| **NoteEntryDate**<br />*Required* | `DateTime` | Date of the note Format: ​`yyyy-MM-dd HH:mm:ssZ`.                                                               |
| **NoteUserName**<br />*Required*  |  `String`  | User who entered the note, if left blank `Channel` will be entered.                                             |
| **IsInternal**                    |  `Boolean` | Indicates if the note is customer visible. For example if set to True then it will not be printed on an invoice |

## Sample

```json Sample Response
{
	"Error": null,
	"HasMorePages": true,
	"Orders": [
		{
			"BillingAddress": {
				"FullName": "Mr Billing Billington",
				"Company": "Linn Systems Ltd",
				"Address1": "2-4 Southgate",
				"Address2": "",
				"Address3": "",
				"Town": "Chichester",
				"Region": "West Sussex",
				"PostCode": "PO19 8DJ",
				"Country": "United Kingdom",
				"CountryCode": "GB",
				"PhoneNumber": "00000000002",
				"EmailAddress": "test@test.com"
			},
			"DeliveryAddress": {
				"FullName": "Mr Testing Testington",
				"Company": "Linn Systems Ltd",
				"Address1": "2-4 Southgate",
				"Address2": "",
				"Address3": "",
				"Town": "Chichester",
				"Region": "West Sussex",
				"PostCode": "PO19 8DJ",
				"Country": "United Kingdom",
				"CountryCode": "GB",
				"PhoneNumber": "00000000001",
				"EmailAddress": "test@test.com"
			},
			"OrderItems": [
				{
					"TaxCostInclusive": true,
					"UseChannelTax": false,
					"IsService": false,
					"OrderLineNumber": "0",
					"SKU": "ChannelProduct_0",
					"PricePerUnit": 0.731495563281465,
					"Qty": 479904921,
					"TaxRate": 20.0,
					"LinePercentDiscount": 0.0,
					"ItemTitle": "Title for MyReference-2ChannelProduct_0",
					"Options": [
						{
							"Name": "Colour",
							"Value": "Red"
						}
					]
				}
			],
			"ExtendedProperties": [
				{
					"Name": "Prop0",
					"Value": "Val0",
					"Type": "Info"
				}
			],
			"Notes": [
				{
					"Note": "A customer has left a note",
					"NoteEntryDate": "2016-08-26T13:28:05Z",
					"NoteUserName": "Channel",
					"IsInternal": false
				}
			],
			"Site": "",
			"MatchPostalServiceTag": "Royal Mail First Class",
			"MatchPaymentMethodTag": "PayPal",
			"PaymentStatus": "PAID",
			"ChannelBuyerName": "A Channel Buyer Name",
			"ReferenceNumber": "MyReference-2",
			"ExternalReference": "MyExternalReference-1",
			"SecondaryReferenceNumber": null,
			"Currency": "GBP",
			"ReceivedDate": "2016-08-26T13:23:05.1678193Z",
			"DispatchBy": "2016-09-05T13:28:05.1678193Z",
			"PaidOn": "2016-08-26T13:19:05.1678193Z",
			"PostalServiceCost": 0.818234497130958,
			"PostalServiceTaxRate": 20.0,
			"UseChannelTax": false
		}
	]
}
```