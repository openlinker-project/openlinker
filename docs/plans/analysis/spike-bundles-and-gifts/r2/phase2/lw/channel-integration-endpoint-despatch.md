---
updatedAt: 2025-12-10T14:10:36.000Z
agentTools:
  projectIndex: https://apidocs.linnworks.net/llms.txt
---

# Endpoint - Despatch

This endpoint is called in batch when users have shipped their orders from Linnworks.

The request may have the whole order with all it's lines or quantities or it may have lines and individual quantities depending how the customer is fulfilling the order.

# Request

<span style={{ backgroundColor: "#0272d9", color: "white", padding: "4px 8px", textAlign: "center", borderRadius: "5px", fontSize: "small" }}>POST</span>

## `DespatchRequest`

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
        **AuthorizationToken**
      </td>

      <td>
        `String`
      </td>

      <td>
        Authorization Token from the customers integration.
      </td>
    </tr>

    <tr>
      <td>
        **Orders**
      </td>

      <td>
        `DespatchOrder[]`
      </td>

      <td>
        Array of dispatches, note due to splitting / cancellation functionality in Linnworks you many not receive all items from the original order.

        If a channel does not support line time or quantity despatch then it's suggested to mark as despatched on the first reference and ignore there after.

        See [DespatchOrder Table.](endpoint-despatch#despatchorder)
      </td>
    </tr>
  </tbody>
</Table>

## `DespatchOrder`

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
        **ReferenceNumber**
      </td>

      <td>
        `String`
      </td>

      <td>
        Unique reference of the order.
      </td>
    </tr>

    <tr>
      <td>
        **ShippingVendor**
      </td>

      <td>
        `String`
      </td>

      <td>
        Shipping Vendor / Carrier as defined by the customer in Linnworks

        If not set will return "NONE"
      </td>
    </tr>

    <tr>
      <td>
        **ShippingMethod**
      </td>

      <td>
        `String`
      </td>

      <td>
        Linnworks method name as defined by the customer in Linnworks

        If not set will return "Default"
      </td>
    </tr>

    <tr>
      <td>
        **TrackingNumber**
      </td>

      <td>
        `String`
      </td>

      <td>
        Tracking Number.
      </td>
    </tr>

    <tr>
      <td>
        **TrackingUrl**
      </td>

      <td>
                   `String`
      </td>

      <td>
        Tracking Url.
      </td>
    </tr>

    <tr>
      <td>
        **SecondaryTrackingNumbers**
      </td>

      <td>
        `String[]`
      </td>

      <td>
        Additional Tracking numbers.
      </td>
    </tr>

    <tr>
      <td>
        **ProcessedOn**
      </td>

      <td>
        `DateTime`
      </td>

      <td>
        Date order was processed in UTC format.
        Format: `yyyy-MM-dd HH:mm:ssZ`
      </td>
    </tr>

    <tr>
      <td>
        **Items**
      </td>

      <td>
        `DespatchItem[]`
      </td>

      <td>
        Order items that are related to the Despatch.

        If the customer has used split packaging in Linnworks the order items might appear multiple times in different groups where they might exist in different packages.

        See [Despatch Item table.](endpoint-despatch#despatchitem)
      </td>
    </tr>

    <tr>
      <td>
        **Packages**
      </td>

      <td>
        `DespatchPacakges[]`
      </td>

      <td>
        Order packages with items grouped by tracking number and shipping method.

        See [Despatch Package Table](endpoint-despatch#despatchpackage)
      </td>
    </tr>
  </tbody>
</Table>

## `DespatchPackage`

<Table align={["left","center","left"]}>
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
        **ShippingVendor**
      </td>

      <td>
        `String`
      </td>

      <td>
        Shipping Vendor / Carrier as defined by the customer in Linnworks
      </td>
    </tr>

    <tr>
      <td>
        **ShippingMethod**
      </td>

      <td>
        `String`
      </td>

      <td>
        Linnworks method name as defined by the customer in Linnworks
      </td>
    </tr>

    <tr>
      <td>
        **TrackingNumber**
      </td>

      <td>
        `String`
      </td>

      <td>
        Tracking Number.
      </td>
    </tr>

    <tr>
      <td>
        **TrackingUrl**
      </td>

      <td>
        `String`
      </td>

      <td>
        Tracking Url.
      </td>
    </tr>

    <tr>
      <td>
        **Items**
      </td>

      <td>
        `DespatchItem[]`
      </td>

      <td>
        Order items that are related to the Despatch.

        If the customer has used split packaging in Linnworks the order items might appear multiple times in different groups where they might exist in different packages.

        See [Despatch Item table.](endpoint-despatch#despatchitem)
      </td>
    </tr>
  </tbody>
</Table>

## `DespatchItem`

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
      </td>

      <td>
        `String`
      </td>

      <td>
        Channel SKU from the order item.
      </td>
    </tr>

    <tr>
      <td>
        **OrderLineNumber**
      </td>

      <td>
        `String`
      </td>

      <td>
        Unique line number from the order item.
      </td>
    </tr>

    <tr>
      <td>
        **DespatchedQuantity**
      </td>

      <td>
        `String`
      </td>

      <td>
        Quantity despatched, due to splits this might be less than the original order and additional quantity may be provided later.
      </td>
    </tr>

    <tr>
      <td>
        **SerialValues**
      </td>

      <td>
        `SerialValueGroup[]`
      </td>

      <td>
        List of scanned serial numbers grouped to the individual despatch item quantity. If supplied.

        See [Serial Values table.](endpoint-despatch#serialvalues)
      </td>
    </tr>
  </tbody>
</Table>

## `SerialValues`

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
        **CorrelationId**
      </td>

      <td>
        `int`
      </td>

      <td>
        A contextual identifier representing the position of a quantity within an order line item.
        This ID is used to associate individual quantity entries with their respective positions in the order's item structure.
      </td>
    </tr>

    <tr>
      <td>
        **SerialValue**
      </td>

      <td>
        `SerialValue[]`
      </td>

      <td>
        List of scanned serial numbers relating to the individual despatch item quantity.

        See [Serial Value table.](endpoint-despatch#serialvalue)
      </td>
    </tr>
  </tbody>
</Table>

## `SerialValue`

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
        **Type**
      </td>

      <td>
        `string`
      </td>

      <td>
        The serial value type.

        Current values include **"AMZNTRANS", "SERIAL", "IMEI"**.
        More may be added later.
      </td>
    </tr>

    <tr>
      <td>
        **Value**
      </td>

      <td>
        `string`
      </td>

      <td>
        The serial value.
      </td>
    </tr>
  </tbody>
</Table>

## `Sample`

```json Sample Request
{
  "Orders": 
  [
    {
      "ReferenceNumber": "12345",
      "ShippingVendor": "Royal Mail",
      "ShippingMethod": "First Class",
      "TrackingNumber": "TrackingNumber 1",
			"TrackingUrl": "TrackingUrl",
      "SecondaryTrackingNumbers": 
      [
        "AnotherTracking"
      ],
      "ProcessedOn": "2016-08-29T07:49:51.5036339Z",
      "Items": 
      [
        {
          "SKU": "SKU1234",
          "OrderLineNumber": "1",
          "DespatchedQuantity": 2
        },
        {
          "SKU": "SKU1235",
          "OrderLineNumber": "2",
          "DespatchedQuantity": 2
        }
      ],
      "Packages": 
      [
       {
         "ShippingVendor": "Royal Mail",
         "ShippingMethod": "First Class",
         "TrackingNumber": "TrackingNumber 1",
				 "TrackingUrl": "TrackingUrl",
         "Items": 
         [
          {
           "SKU": "SKU1234",
           "OrderLineNumber": "1",
           "DespatchedQuantity": 2,
           "SerialValues": 
           [
            {
             "CorrelationId": 1,
             "SerialValue": 
             [
              {
               "Type": "IMEI",
               "Value": "1234352"
              },
              {
               "Type": "Serial",
               "Value": "687987989799"
              }
             ]
            }
           ]
           },
          {
           "SKU": "SKU1235",
           "OrderLineNumber": "2",
           "DespatchedQuantity": 2
           }
          ]}
    ]}
  ],
  "AuthorizationToken": "b7f4ee81bc4e4363adcd00eced0ea471"
}
```

# Response

## `DespatchResponse`

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
      </td>
    </tr>

    <tr>
      <td>
        **Orders**
      </td>

      <td>
        `DespatchOrderResponse[]`
      </td>

      <td>
        Array of orders and the results of the despatch.

        If there are no errors it is still expected to return the reference with no error otherwise we assume the order was not found and do not confirm despatch back to the user.

        See [Despatch Order Response table.](endpoint-despatch#despatchorderresponse)
      </td>
    </tr>
  </tbody>
</Table>

## `DespatchOrderResponse`

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
        If there was an error with the individual order.
      </td>
    </tr>

    <tr>
      <td>
        **ReferenceNumber**
        _Required_
      </td>

      <td>
        `String`
      </td>

      <td>
        Reference number of the order.
      </td>
    </tr>

    <tr>
      <td>
        **Retry**
      </td>

      <td>
        `Boolean`
      </td>

      <td>
        Indicates if an individual order will be retried. Will retry up to a maximum of 10 times.
      </td>
    </tr>
  </tbody>
</Table>

## Sample

```json Sample Response
{
	"Error": null,
	"Orders": [
		{
			"Error": "Despatch failed for some reason",
			"ReferenceNumber": "12345"
		},
    {
			"Error": null,
			"ReferenceNumber": "12346"
		}
	]
}
```