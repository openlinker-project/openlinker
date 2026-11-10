---
updatedAt: 2026-09-30T10:33:47.000Z
agentTools:
  projectIndex: https://apidocs.linnworks.net/llms.txt
---

# Endpoint - User Config

This request is made in two situations:

Firstly when a customer is going through the integration wizard to integrate the channel for the first time or when required updates are needed. The wizard `StepName` should be anything but `UserConfig` if you are flowing a user through integration steps. To complete the wizard then return the `StepName` as "UserConfig"  this will indicate the wizard is complete and complete the wizard for the user.

The second instance is when the config is loaded the call is made to load any dynamic `ConfigItems` that may be required to show on the Linnworks config UI. `SaveConfigEndpoint` will be called on each wizard step and when the config is saved.

If the config is loaded and the `StepName` is not `UserConfig` it will load the config wizard and take them through the stages until `UserConfig` is returned. This can be especially useful if the user is required to go through additional steps down the line such as updating an auth token.

This call is not called periodically and only when the user is editing their configuration.

# Request

<span style={{ backgroundColor: "#0272d9", color: "white", padding: "4px 8px", textAlign: "center", borderRadius: "5px", fontSize: "small" }}>POST</span>

## `UserConfigRequest`

| Field Name             |   Type   | Description                                 |
| ---------------------- | :------: | ------------------------------------------- |
| **AuthorizationToken** | `String` | Token that you generated for this customer. |

## Sample

```json Sample Request
{
	"AuthorizationToken": "a8e53e86eead4b69beaa0afcc29b67fb",
}
```

# Response

## `UserConfigResponse`

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
        **Error**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Error string if there was an issue with the request.
      </td>
    </tr>

    <tr>
      <td>
        **StepName**<br />_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Current Step name, if returned "UserConfig" it will assume that the wizard is complete.
      </td>
    </tr>

    <tr>
      <td>
        **AccountName**<br />_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Account name being integrated into the system. Will never change and on integration it is suggest that duplicates are checked for. Nb. Customers may expect to have multiple integrations of the same channel in Linnworks.
      </td>
    </tr>

    <tr>
      <td>
        **WizardStepDescription**<br />_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Description of the current wizard step.
      </td>
    </tr>

    <tr>
      <td>
        **WizardStepTitle**<br />_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        User visible title displayed on the integration wizard.
      </td>
    </tr>

    <tr>
      <td>
        **ConfigItems**<br />_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `ConfigItem[]`
      </td>

      <td>
        See Config Item table.
      </td>
    </tr>

    <tr>
      <td>
        **GlobalConfigSettings**<br />_Optional_
      </td>

      <td style={{ textAlign: "center" }}>
        `GlobalConfigSettings`
      </td>

      <td>
        A set of global config settings for the individual integration. These include available price tags as well as options to disable UI config elements if not supported.

        These options help sellers easily identify what is supported and what is not rather than raising support cases when something seemingly doesn't work.

        The default behavior is that all features are supported if no settings are provided by the integration.
      </td>
    </tr>
  </tbody>
</Table>

## `ConfigItem`

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
        **ConfigItemId**<br />_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Unique id of either the wizard item or config item.
      </td>
    </tr>

    <tr>
      <td>
        **Description**<br />_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Description of the config item or wizard item. Will be displayed in tooltips .
      </td>
    </tr>

    <tr>
      <td>
        **GroupName**<br />_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Used to group the config or wizard items.
      </td>
    </tr>

    <tr>
      <td>
        **ListValues**
      </td>

      <td style={{ textAlign: "center" }}>
        `ListValue[]`
      </td>

      <td>
        See List Value table.
      </td>
    </tr>

    <tr>
      <td>
        **MustBeSpecified**
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Defines if the user must enter this value in the wizard or config.
      </td>
    </tr>

    <tr>
      <td>
        **Name**<br />_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Visible name on the wizard or config.
      </td>
    </tr>

    <tr>
      <td>
        **ReadOnly**
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Defines if the field is a visible only field.
      </td>
    </tr>

    <tr>
      <td>
        **RegexError**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Message that will be shown to the custmer if wizard field validation does not go through.
      </td>
    </tr>

    <tr>
      <td>
        **RegexValidation**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        JavaScript Regex validation script.
      </td>
    </tr>

    <tr>
      <td>
        **SelectedValue**
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Selected value either default value or value selected in the UI when sent back.
      </td>
    </tr>

    <tr>
      <td>
        **Sortorder**<br />_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `Int`
      </td>

      <td>
        Order of config item to be displayed on the UI.
      </td>
    </tr>

    <tr>
      <td>
        **ValueType**<br />_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `String`
      </td>

      <td>
        Valid values:

        * STRING
        * INT
        * DOUBLE
        * BOOLEAN
        * PASSWORD
        * LIST
      </td>
    </tr>

    <tr>
      <td>
        **HidesHeaderAttribute**
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Determines whether a header-level attribute (e.g. InventorySync) should be hidden from the config. Used in conjunction with the Name property, where Name identifies the attribute to hide.
      </td>
    </tr>
  </tbody>
</Table>

## `ListValue`

| Field Name                  |   Type   | Description                                                                                             |
| --------------------------- | :------: | ------------------------------------------------------------------------------------------------------- |
| **Display**<br />*Required* | `String` | User friendly visible value.                                                                            |
| **Value**<br />*Required*   | `String` | Key value that Linnworks will then send back in the `SelectedValue` field on the **SaveConfigEndpont**. |

<br />

## `GlobalConfigSettings`

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
        **PriceTags**<br />_Optional_
      </td>

      <td style={{ textAlign: "center" }}>
        `String[]`
      </td>

      <td>
        Price tags that are available to be used in conjunction with the price sync.
        For example this may be `SALE_PRICE` or `UK`

        * _Formatting_\*:
        * **Maximum Length** - 20 Characters - Any longer than this and they will be truncated.
        * Full capitals
        * Instead of spaces either `_` or `-` is used.
        * Do not repeat tags with different casing.
      </td>
    </tr>

    <tr>
      <td>
        **IsPriceChangeVisible**<br />_Optional_
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Defines if the price change tick box in the config should be visible for the users

        `True` - Price change tick box will be shown
        `False`- Price change tick box will be hidden
        `Not provided` - Price change tick box will be shown.
      </td>
    </tr>

    <tr>
      <td>
        **IsRefundsVisible**<br />_Optional_
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Defines if the refunds tick box in the config should be visible for the users

        `True` - Refunds tick box will be shown
        `False`- Refundstick box will be hidden
        `Not provided` - Refundstick box will be shown.
      </td>
    </tr>

    <tr>
      <td>
        **IsCancellationsVisible**<br />_Optional_
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Defines if the cancellations tick box in the config should be visible for the users

        `True` - Cancellations tick box will be shown
        `False`- Cancellations tick box will be hidden
        `Not provided` - Cancellations tick box will be shown.
      </td>
    </tr>

    <tr>
      <td>
        **IsShippingMappingVisible**<br />_Optional_
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Defines if the shipping mapping button in the channel integrations screen should be enabled for the users.

        `True` - Shipping mapping button will be enabled
        `False`- Shipping mapping button will be disabled
        `Not provided` - Shipping mapping button will be enabled
      </td>
    </tr>

    <tr>
      <td>
        **IsPaymentMappingVisible**<br />_Optional_
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Defines if the payment mapping button in the channel integrations screen should be enabled for the users.

        `True` - Payment mapping button will be enabled
        `False`- Payment mapping button will be disabled
        `Not provided` - Payment mapping button will be enabled
      </td>
    </tr>

    <tr>
      <td>
        **IsInventoryMappingVisible**<br />_Optional_
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Defines if the inventory mapping button in the channel integrations screen should be enabled for the users.

        `True` - Inventory mapping button will be enabled
        `False`- Inventorymapping button will be disabled
        `Not provided` - Inventory mapping button will be enabled
      </td>
    </tr>

    <tr>
      <td>
        **IsPosOrderProcessingVisibl**&#x65;_<br />Optional_
      </td>

      <td style={{ textAlign: "center" }}>
        <div align="center">`Boolean`</div>
      </td>

      <td>
        Defines if the "Process POS Orders" and "Deduct Stock for Fulfilled POS Orders" settings show in the channel integration settings.

        `True` - Both POS settings are visible to the user.
        `False` - Both POS settings are hidden.
        `Not provided` - Both POS settings are hidden.
      </td>
    </tr>

    <tr>
      <td>
        **IsMultilocationEnabled**<br />_Optional_
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Defines if the channel supports multi location.

        `True` - Customers UI will be switched to multi location style and inventory update will start providing the Multi location levels
        `False`- Customers UI will be classic inventory update style (Multiple Linnworks locations to combined channel quantity)
        `Not provided` - Inventory mapping button will be enabled
      </td>
    </tr>

    <tr>
      <td>
        **MultiLocationInventory**<br />_Conditional_
      </td>

      <td style={{ textAlign: "center" }}>
        `MultiLocationInventory`
      </td>

      <td>
        Object for multi location inventory settings
      </td>
    </tr>
  </tbody>
</Table>

<br />

## `MultiLocationInventory`

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
        **OrdersLocationIdAlwaysProvided**<br />_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        Defines if order location location Id is provided for all locations
        If not always then the location specific mapping will be supplied.

        `True` - Customer will be provided an order location mapping for each specific MLI location

        `False`- Customers will be provided an order location mapping at a global level. If then `OrdersLocationIdProvided` `True` provided for a specific location then they will be provided a order location mapping additionally
      </td>
    </tr>

    <tr>
      <td>
        **AutoPopulateLocations**<br />_Required_
      </td>

      <td style={{ textAlign: "center" }}>
        `Boolean`
      </td>

      <td>
        `True` - List of locations to the user will be automatically taken from the `Locations` array.
        `False`- If locations array can be null, this allows user input of locations via UI
      </td>
    </tr>

    <tr>
      <td>
        **Locations**<br />_Conditional_
      </td>

      <td style={{ textAlign: "center" }}>
        `Locations[]`
      </td>

      <td>
        List of MLI locations.
      </td>
    </tr>
  </tbody>
</Table>

<br />

## `Locations`

| Field Name                                   |    Type   | Description                                                                                                                                                                                                           |
| -------------------------------------------- | :-------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tag**<br />*Required*                      |  `String` | Tag will be provided on Inventory update                                                                                                                                                                              |
| **Friendly Name**<br />*Required*            |  `String` | \`Name will be provided to the end customer.                                                                                                                                                                          |
| **OrdersLocationIdProvided**<br />*Required* | `Boolean` | `True` - Customer will be provided an order location mapping for the specific location<br />`False`- Order location mapping for the specific location will be hidden unless `OrdersLocationIdAlwaysProvided`is `True` |

## Sample

```json Sample Response
{
  "Error": null,
  "StepName": "AddCredentials",
  "WizardStepDescription": "This is where you add your website credentials",
  "WizardStepTitle": "Add Credentials",
  "GlobalConfigSettings": {
    "PriceTags": [
      "UK",
      "DE",
      "SALE",
      "UK_SALE"
    ],
    "IsShippingMappingVisible": true,
    "IsPriceChangeVisible": true,
    "IsPaymentMappingVisible": false,
    "IsCancellationsVisible": false,
    "IsRefundsVisible": false,
    "IsInventoryMappingVisible": true,
		"IsMultilocationEnabled": true, 
    "MultiLocationInventory":
    {
            "OrdersLocationIdAlwaysProvided": false,
            "AutoPopulateLocations": true, //If false locations array below can be null, this allows user input of locations via UI 
            "Locations": [
                {
                  "Tag": "Location_1",
                  "Friendly Name": "Warehouse One",
                  "OrdersLocationIdProvided": true //This field can override IsMultilocationIsOrdersLocationsSpecific
                },
                {
                  "Tag": "Location_2",
                  "Friendly Name": "Other Warehouse",
                  "OrdersLocationIdProvided": false
                }
            ]
    	},
  },
  "ConfigItems": [
    {
      "ConfigItemId": "APIKey",
      "Name": "API Key",
      "Description": "Website API Key",
      "GroupName": "API Credentials",
      "SortOrder": 1,
      "SelectedValue": "AnApiKeyGoesHere",
      "RegExValidation": null,
      "RegExError": null,
      "MustBeSpecified": true,
      "ReadOnly": false,
      "ListValues": [],
      "ValueType": "PASSWORD"
    },
    {
      "ConfigItemId": "APISecretKey",
      "Name": "API Secret Key",
      "Description": "Website API Secret Key",
      "GroupName": "API Credentials",
      "SortOrder": 2,
      "SelectedValue": "MYSuperSecretKey",
      "RegExValidation": null,
      "RegExError": null,
      "MustBeSpecified": true,
      "ReadOnly": false,
      "ListValues": [],
      "ValueType": "PASSWORD"
    },
    {
      "ConfigItemId": "IsOauth",
      "Name": "Is Oauth",
      "Description": "Defines if the authentication type is Oauth",
      "GroupName": "API Settings",
      "SortOrder": 3,
      "SelectedValue": "False",
      "RegExValidation": null,
      "RegExError": null,
      "MustBeSpecified": true,
      "ReadOnly": false,
      "ListValues": [],
      "ValueType": "BOOLEAN"
    },
    {
      "ConfigItemId": "Version",
      "Name": "Version",
      "Description": "Version of the API",
      "GroupName": "API Settings",
      "SortOrder": 3,
      "SelectedValue": "False",
      "RegExValidation": null,
      "RegExError": null,
      "MustBeSpecified": true,
      "ReadOnly": false,
      "ListValues": [
        {
          "Display": "1.6 - Stable",
          "Value": "1.6.0"
        },
        {
          "Display": "1.6 - Beta",
          "Value": "1.6.1"
        },
        {
          "Display": "1.5 - Stable",
          "Value": "1.5.0"
        }
      ],
      "ValueType": "LIST"
    }
  ]
}
```