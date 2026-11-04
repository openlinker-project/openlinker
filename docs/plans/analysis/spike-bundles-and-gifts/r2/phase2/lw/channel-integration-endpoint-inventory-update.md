---
updatedAt: 2025-09-09T22:36:44.000Z
agentTools:
  projectIndex: https://apidocs.linnworks.net/llms.txt
---

# Endpoint - Inventory Update

This call is made when inventory is updated in Linnworks and is required to push to the channel.

# Request

<span style={{ backgroundColor: "#0272d9", color: "white", padding: "4px 8px", textAlign: "center", borderRadius: "5px", fontSize: "small" }}>POST</span>

## `InventoryUpdateRequest`

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
        **Products**
      </td>

      <td>
        `ProductInventory[]`
      </td>

      <td>
        Array of product inventory that has been updated in Linnworks and is relevant for change.

        See [Inventory Product table.](endpoint-inventory-update#productinventory)
      </td>
    </tr>
  </tbody>
</Table>

## `ProductInventory`

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
        Product SKU provided from the mapping call, known as Channel SKU in Linnworks
      </td>
    </tr>

    <tr>
      <td>
        **Reference**
      </td>

      <td>
        `String`
      </td>

      <td>
        Reference provided from the mapping call.
      </td>
    </tr>

    <tr>
      <td>
        **Quantity**
      </td>

      <td>
        `Int`
      </td>

      <td>
        New available quantity. Linnworks calculates stock less what is in open orders (unless the order is locked) and also has settings for max listed, percentage and end when so this figure might not directly match the quantities in Linnworks.

        Quantities will never be negative.
      </td>
    </tr>

    <tr>
      <td>
        **MultiLocationLevels**
      </td>

      <td>
        `MultiLocationLevels[]`
      </td>

      <td>
        Multi location levels, only provided when MLI is provided
      </td>
    </tr>
  </tbody>
</Table>

## `MultiLocationLevels`

| Field Name   |   Type   | Description                                      |
| ------------ | :------: | ------------------------------------------------ |
| **Tag**      | `String` | Location tag as provided in the Location Mapping |
| **Quantity** |   `Int`  | Individual MLI quantity.                         |

## Sample

```json Sample Request
{
	"Products": [
		{
			"SKU": "ABC1234",
			"Reference": "122440",
      "Quantity": 10,
			"MultiLocationLevels": [
        {
          "Tag": "1234",
          "Quantity": 5
        },
        {
          "Tag": "9876",
          "Quantity": 2
        },
        {
          "Tag": "ABCD",
          "Quantity": 3
        }
      ]

		}
	],
	"AuthorizationToken": "4d1aa44d211641a48da9ae269ff68975"
}
```

# Response

## `InventoryUpdateResponse`

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
        If there was a global error with the request.
      </td>
    </tr>

    <tr>
      <td>
        **Products**
        _Required_
      </td>

      <td>
        `ProductInventoryError[]`
      </td>

      <td>
        Products process result.

        If there are no errors the SKU is still expected to be returned, any items not returned may be assumed to be not existing on the marketplace and therefore may be ignored on subsequent updates.

        See [ProductInventoryError table.](endpoint-inventory-update#productinventoryerror)
      </td>
    </tr>
  </tbody>
</Table>

## `ProductInventoryError`

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
        Product SKU.
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
        If there was an error with SKU.
      </td>
    </tr>
  </tbody>
</Table>

## Sample

```json Sample Response
{
	"Error": null,
	"Products": [
		{
			"Error": "SKU does not exist",
			"SKU": "MyNonExistantSKU"
		},
    {
			"Error": null,
			"SKU": "MySuccessfulSKU"
		}
	]
}
```