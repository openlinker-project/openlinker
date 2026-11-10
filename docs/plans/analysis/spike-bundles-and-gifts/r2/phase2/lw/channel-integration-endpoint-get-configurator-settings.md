---
updatedAt: 2026-03-05T12:19:50.000Z
agentTools:
  projectIndex: https://apidocs.linnworks.net/llms.txt
---

# Endpoint - Get Configurator Settings

This endpoint contains settings that are then used to determine the listing screen layout in Linnworks, how Linnworks processes and validates data provided by the customer and which customer settings are required to be filled out by the customer in order to create a successful listing.

This endpoint contains settings that are then used to determine the listing screen layout in Linnworks, how Linnworks processes and validates data provided by the customer and which customer settings are required to be filled out by the customer in order to create a successful listing.

This endpoint does not require an authorization token as the setting aren't specific to a particular channel integration and global to the channel integration.

# Request

<span style={{ backgroundColor: "#0272d9", color: "white", padding: "4px 8px", textAlign: "center", borderRadius: "5px", fontSize: "small" }}>POST</span>

## Sample

No parameters / content

```json Sample Request
{
}
```

# Response

## `ConfiguratorSettingsResponse`

| Field Name                           |         Type         | Description                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | :------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Settings**                         | `CustomerSettings[]` | See [CustomerSettings ](#customersettings)table. Various settings that are needed for listing creation. E.g. variation settings, returns settings etc.                                                                                                                                                                                                                                        |
| **MaxDescriptionLength**             |       `Integer`      | Is used to validate that the description set for the listing is not above the MaxDescriptionLength when the template description is saved.                                                                                                                                                                                                                                                    |
| **ImageSettings**                    |    `ListingImage`    | See [ListingImage ](#listingimage)table. Settings that will be applied to images used in listings on given selling channel.                                                                                                                                                                                                                                                                   |
| **MaxCategoryCount**                 |       `Integer`      | Currently unused. Please return a non-null value.                                                                                                                                                                                                                                                                                                                                             |
| **MaxCustomAttributeLength**         |       `Integer`      | Currently unused. Please return a non-null value.                                                                                                                                                                                                                                                                                                                                             |
| **IsCustomHtmlSupported**            |       `Boolean`      | If set to true, will have the description editor on template level that will allow customers to add html descriptions.                                                                                                                                                                                                                                                                        |
| **IsCustomAttributesAllowed**        |       `Boolean`      | If set to true allows the customer to add their own custom attribute and value which will be sent to the external application at the time of listing creation / update.                                                                                                                                                                                                                       |
| **IsVariationsAllowed**              |       `Boolean`      | If set to true, allows customers to create variation listings. If set to false, variation window on configurator and template window will not display.                                                                                                                                                                                                                                        |
| **HasMainVariationPrice**            |       `Boolean`      | If set to true and the item is a variation listing, sets the price on the template                                                                                                                                                                                                                                                                                                            |
| **IsTitleInVariation**               |       `Boolean`      | If set to true and the item is a variation listing, each variation child item can have its own title.                                                                                                                                                                                                                                                                                         |
| **HasVariationAttributeDisplayName** |       `Boolean`      | Not being used.                                                                                                                                                                                                                                                                                                                                                                               |
| **IsPriceInVariation**               |       `Boolean`      | If set to true and the item is a variation listing, then each variation child item will have its own price on the template.                                                                                                                                                                                                                                                                   |
| **IsShippingListingSpecific**        |       `Boolean`      | If true then shipping configurator and template window will display for the customer in Configurator screen. The list of shipping methods the customer can select from will be taken from the Channel Integration -> Channel Shipping ( [Shipping Tags](https://apidocs.linnworks.net/docs/endpoint-shipping-tags) of channel integration endpoint). It will be possible also to set a price for a specific shipping method. |
| **IsPaymentListingSpecific**         |       `Boolean`      | If true then payment configurator window will display for the customer. The list of payment methods the customer can select from will be taken from the [PaymentTagsEndpoint](https://apidocs.linnworks.net/docs/endpoint-payment-tags) list (channel integration endpoint).                                                                                                                                                 |
| **Error**                            |       `String`       | Dislays error if there was an error with the request and returns it.                                                                                                                                                                                                                                                                                                                          |

## `CustomerSettings`

| Field Name               |         Type         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | :------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GroupName**            | `GroupNameValueType` | See [GroupNameValueType ](#groupnamevaluetype-flagged-enum)table. This specifies which configurator window this setting will be displayed in. Anything that cannot be classified as "Returns", "Variations" etc – is "General".                                                                                                                                                                                                                                                                                                                                                      |
| **ConfigItemId**         |       `String`       | Unique identifier for the setting. E.g. setting could be: "Site", "Currency", "Item condition" etc.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Subtitle**             |       `String`       | Name for Subtitle under which settings will be displayed in the window. E.g. "Site" and "Currency" could be displayed under "Account" Subtitle and "Item condition" under "Condition" Subtitle.                                                                                                                                                                                                                                                                                                                                                                                      |
| **SubTitleSortOrder**    |       `Integer`      | Order in which Subtitle will be displayed in the window. E.g. "Account" could be displayed 1st and "Condition" 2nd.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **ItemSortOrder**        |       `Integer`      | Order in which given setting will be displayed (e.g. "Site" could be displayed before "Currency").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Description**          |       `String`       | A short description that will be displayed as a tooltip to give the customer an idea of what the setting is used for.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **FriendlyName**         |       `String`       | Is used to display the setting to the customer. E.g. "Site", "Currency", "Item Condition" etc.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **MustBeSpecified**      |       `Boolean`      | Currently unused. Please return a non-null value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **ExpectedType**         |  `ListingValueType`  | See [ListingValueType ](#listingvaluetype-flagged-enum)table. Defines data type for the listing value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **ValueOptions**         |      `String[]`      | Provides a list of options the customer can select from.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **InitialValues**        |      `String[]`      | Sets the initial value of the setting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **IsMultiOption**        |       `Boolean`      | Currently unused. Please return a non-null value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **ValueFromOptionsList** |       `Boolean`      | Currently unused. Please return a non-null value..                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **RegExValidation**      |       `String`       | Currently unused. Please return a non-null value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **RegExError**           |       `String`       | Currently unused. Please return a non-null value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **IsWizardOnly**         |       `Boolean`      | Should be set to true, if the setting is used to determine attributes or variations. These settings will need to be set by the customer when a new configurator is created and cannot be changed once the configurator has been created. E.g. if you set "size-colour" theme for variations and created a configurator with this theme and listed some items, later you cannot change the theme to "size" or "colour" in this configurator – as there would be listings already listed using "sizecolour" theme. You could however create a new configurator with just "size" theme. |

## `GroupNameValueType (Flagged Enum)`

| Flag          | Numeric Value | Description                            |
| ------------- | :-----------: | -------------------------------------- |
| **GENERAL**   |      `1`      | Configurator window called "General"   |
| **RETURN**    |      `2`      | Configurator window called "Return"    |
| **SHIPPING**  |      `3`      | Configurator window called "Shipping"  |
| **PAYMENT**   |      `4`      | Configurator window called "Payment"   |
| **VARIATION** |      `5`      | Configurator window called "Variation" |

## `ListingValueType (Flagged Enum)`

| Flag         | Numeric Value | Description            |
| ------------ | :-----------: | ---------------------- |
| **STRING**   |      `1`      | Value of type String   |
| **INT**      |      `2`      | Value of type Integer  |
| **DECIMAL**  |      `3`      | Value of type Decimal  |
| **BOOL**     |      `4`      | Value of type Boolean  |
| **DATETIME** |      `5`      | Value of type DateTime |
| **LIST**     |      `6`      | Value of type list     |

## `ListingImage`

| Field Name           |        Type        | Description                                                                                                                                      |
| -------------------- | :----------------: | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Type**             | `ImageListingType` | See [ImageListingType ](#imagelistingtypeflagged-enum)table. Determines how the listing tool will deal with listing images.                      |
| **MaxImages**        |      `Integer`     | See in [ImageListingType ](#imagelistingtypeflagged-enum)how it is used.                                                                         |
| **MaxVariantImages** |      `Integer`     | See in [ImageListingType ](#imagelistingtypeflagged-enum)how it is used.                                                                         |
| **ImageTags**        |    `ImageTag[]`    | See [ImageTag ](#imagetag)table. Image option tags that are available on the channel, e.g. "basket image", "large image", "thumbnail image" etc. |

## `ImageListingType(Flagged Enum)`

<Table align={[null,"center",null]}>
  <thead>
    <tr>
      <th>
        Flag
      </th>

      <th>
        Numeric Value
      </th>

      <th>
        Description
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        **CountTogether**
      </td>

      <td>
        `1`
      </td>

      <td>
        Uses MaxImages (see

        [ListingImage](#listingimage)

        ) and MaxVariantImages(see

        [ListingImage](#listingimage)

        ).
        For non variation listings: A max of MaxVariantImages uploaded images will be taken from the stock item and a total of MaxImages images will be selected.
        For variation listings: The variation parent and each child item will have a section to select images. A total of MaxVariationImages uploaded images from the variation parent stock item will be added to the Main image section. Uploaded images from each variation child stock item will be added to each variation child item section. For each variation child section a max of MaxVariationImages will be taken. Starting from the variation parent images and following on to each variation child images, each Image will be marked as Selected until MaxTotalImages has been reached.
      </td>
    </tr>

    <tr>
      <td>
        **CountMainVariantsSeparately**
      </td>

      <td>
        `2`
      </td>

      <td>
        Uses MaxImages and MaxVariantImages.
        For non variation listings: Uploaded images will be taken from the stock item and a total of MaxImages images will be selected.
        For variation listings: The Main Images will be taken from the variation parent item and a total of MaxImages will be selected. Uploaded images from each variation child stock item will be added to each variation child item section and a maximum of MaxVariantImages will be selected.
      </td>
    </tr>

    <tr>
      <td>
        **SelectVariationFromMain**
      </td>

      <td>
        `3`
      </td>

      <td>
        Uses MaxImages and MaxVariantImages.
        For non variation listings:Uploaded images will be taken from the stock item and a total of MaxImages images will be selected.
        For variation listings: The Main Images will be taken from the variation parent item and each variation child item uploaded images and a total of MaxImages will be selected. Uploaded images from each variation child stock item will be added to each variation child item section and a maximum of MaxVariantImages will be selected.
      </td>
    </tr>
  </tbody>
</Table>

## `ImageTag`

| Field Name       |      Type      | Description                                                              |
| ---------------- | :------------: | ------------------------------------------------------------------------ |
| **Name**         |    `String`    | E.g. Main Image, Thumbnail, Basket, Large Image etc.                     |
| **ImageTagType** | `ImageTagType` | See in [ImageListingType ](#imagelistingtypeflagged-enum)how it is used. |

## `ImageTagType(Flagged Enum)`

| Flag          | Numeric Value | Description                           |
| ------------- | :-----------: | ------------------------------------- |
| **SingleTag** |      `1`      | Only one main image can be selected.  |
| **MultiTag**  |      `2`      | Multiple main images can be selected. |

## Sample

```json Sample Response
{
  "Error": null,
  "Settings": [
    {
      "GroupName": "VARIATION",
      "ConfigItemId": "VariationTheme",
      "Subtitle": "General",
      "SubTitleSortOrder": 1,
      "ItemSortOrder": 1,
      "Description": "Theme used for variation. Cannot be changed once config created",
      "FriendlyName": "Variation Theme",
      "MustBeSpecified": false,
      "ExpectedType": "STRING",
      "ValueOptions": [
        "Color",
        "Size",
        "Color-Size"
      ],
      "InitialValues": [],
      "IsMultiOption": false,
      "ValueFromOptionsList": true,
      "RegExValidation": "",
      "RegExError": "",
      "IsWizardOnly": true
    },
    {
      "GroupName": "RETURN",
      "ConfigItemId": "ReturnCost",
      "Subtitle": "General:",
      "SubTitleSortOrder": 1,
      "ItemSortOrder": 1,
      "Description": "Please select who will cover return shipping cost",
      "FriendlyName": "Return paid by:",
      "MustBeSpecified": true,
      "ExpectedType": "STRING",
      "ValueOptions": [
        "Buyer",
        "Seller"
      ],
      "InitialValues": [
        "Buyer"
      ],
      "IsMultiOption": false,
      "ValueFromOptionsList": true,
      "RegExValidation": "",
      "RegExError": "",
      "IsWizardOnly": false
    },
    {
      "GroupName": "RETURN",
      "ConfigItemId": "ReturnDays",
      "Subtitle": "General",
      "SubTitleSortOrder": 1,
      "ItemSortOrder": 2,
      "Description": "Please select number of days after sale return can be submitted within",
      "FriendlyName": "Return within:",
      "MustBeSpecified": true,
      "ExpectedType": "INT",
      "ValueOptions": [
        7,
        14,
        30,
        60,
        90
      ],
      "InitialValues": [
        14
      ],
      "IsMultiOption": false,
      "ValueFromOptionsList": true,
      "RegExValidation": "",
      "RegExError": "",
      "IsWizardOnly": false
    },
    {
      "GroupName": "SHIPPING",
      "ConfigItemId": "ShippedFromCountry",
      "Subtitle": "General settings:",
      "SubTitleSortOrder": 1,
      "ItemSortOrder": 1,
      "Description": "",
      "FriendlyName": "Country:",
      "MustBeSpecified": false,
      "ExpectedType": "STRING",
      "ValueOptions": [
        "United Kingdom",
        "USA"
      ],
      "InitialValues": [],
      "IsMultiOption": false,
      "ValueFromOptionsList": true,
      "RegExValidation": "",
      "RegExError": "",
      "IsWizardOnly": false
    },
    {
      "GroupName": "SHIPPING",
      "ConfigItemId": "ShippedFromTown",
      "Subtitle": "General settings:",
      "SubTitleSortOrder": 1,
      "ItemSortOrder": 2,
      "Description": "",
      "FriendlyName": "Town:",
      "MustBeSpecified": false,
      "ExpectedType": "STRING",
      "ValueOptions": [],
      "InitialValues": [],
      "IsMultiOption": false,
      "ValueFromOptionsList": false,
      "RegExValidation": "",
      "RegExError": "",
      "IsWizardOnly": false
    },
    {
      "GroupName": "SHIPPING",
      "ConfigItemId": "ShippedFromPostCode",
      "Subtitle": "General settings:",
      "SubTitleSortOrder": 1,
      "ItemSortOrder": 3,
      "Description": "",
      "FriendlyName": "Postcode:",
      "MustBeSpecified": false,
      "ExpectedType": "STRING",
      "ValueOptions": [],
      "InitialValues": [],
      "IsMultiOption": false,
      "ValueFromOptionsList": false,
      "RegExValidation": "",
      "RegExError": "",
      "IsWizardOnly": false
    },
    {
      "GroupName": "SHIPPING",
      "ConfigItemId": "DomesticShippingExcl",
      "Subtitle": "Domestic",
      "SubTitleSortOrder": 2,
      "ItemSortOrder": 1,
      "Description": "Enter post codes where you do not ship",
      "FriendlyName": "Shipping postcodes excluded:",
      "MustBeSpecified": false,
      "ExpectedType": "STRING",
      "ValueOptions": [],
      "InitialValues": [],
      "IsMultiOption": true,
      "ValueFromOptionsList": false,
      "RegExValidation": "",
      "RegExError": "",
      "IsWizardOnly": false
    },
    {
      "GroupName": "SHIPPING",
      "ConfigItemId": "IntShippingExcl",
      "Subtitle": "International:",
      "SubTitleSortOrder": 3,
      "ItemSortOrder": 1,
      "Description": "Select countries where you do not ship",
      "FriendlyName": "Shipping countries excluded:",
      "MustBeSpecified": false,
      "ExpectedType": "STRING",
      "ValueOptions": [
        "Republic of Ireland",
        "France",
        "Italy",
        "Spain",
        "Germany",
        "Austria",
        "Switzerland",
        "Sweden",
        "Norway",
        "Finland",
        "Denmark",
        "Estonia",
        "Latvia",
        "Lithuania",
        "Poland"
      ],
      "InitialValues": [],
      "IsMultiOption": true,
      "ValueFromOptionsList": true,
      "RegExValidation": "",
      "RegExError": "",
      "IsWizardOnly": false
    }
  ],
  "MaxDescriptionLength": 10000,
  "ImageSettings": {
    "Type": 2,
    "MaxImages": 100,
    "MaxVariantImages": 4,
    "ImageTags": [
      {
        "Name": "Main_image",
        "ImageTagType": 2
      },
      {
        "Name": "Large_image",
        "ImageTagType": 2
      },
      {
        "Name": "Thumbnail_image",
        "ImageTagType": 1
      },
      {
        "Name": "Basket_image",
        "ImageTagType": 1
      }
    ]
  },
  "MaxCategoryCount": 1000,
  "MaxCustomAttributeLength": 1000,
  "IsCustomHtmlSupported": true,
  "IsCustomAttributesAllowed": true,
  "IsVariationsAllowed": true,
  "HasMainVariationPrice": true,
  "IsTitleInVariation": false,
  "HasVariationAttributeDisplayName": true,
  "IsPriceInVariation": true,
  "IsShippingListingSpecific": true,
  "IsPaymentListingSpecific": true
}
```