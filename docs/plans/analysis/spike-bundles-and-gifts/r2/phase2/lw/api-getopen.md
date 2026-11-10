---
updatedAt: 2026-05-27T10:33:58.000Z
agentTools:
  projectIndex: https://apidocs.linnworks.net/llms.txt
---

# GetOpenOrdersDetails

Open order details by order ids. Not limited by the number of orders you can retrieve. This call is designed to return ONLY open orders, 
it is much faster than GetOrderDetail call
<b>Permissions Required: </b> GlobalPermissions.OrderBook.ViewOrderDetailsNode
<b>Rate limit: </b><span style="background-color:#0272d9;color:white;padding:4px 8px;text-align:center;border-radius:5px; font-size: small;"><b>150</b></span> / minute

# OpenAPI definition

```json
{
  "openapi": "3.0.0",
  "info": {
    "version": "openorders",
    "title": "Open Orders API"
  },
  "paths": {
    "/api/OpenOrders/GetOpenOrdersDetails": {
      "post": {
        "tags": [
          "OpenOrders"
        ],
        "summary": "GetOpenOrdersDetails",
        "description": "Open order details by order ids. Not limited by the number of orders you can retrieve. This call is designed to return ONLY open orders, \r\nit is much faster than GetOrderDetail call\n<b>Permissions Required: </b> GlobalPermissions.OrderBook.ViewOrderDetailsNode\n<b>Rate limit: </b><span style=\"background-color:#0272d9;color:white;padding:4px 8px;text-align:center;border-radius:5px; font-size: small;\"><b>150</b></span> / minute",
        "operationId": "GetOpenOrdersDetails",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/GetOpenOrdersDetailsRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/GetOpenOrdersDetailsResponse"
                }
              },
              "text/json": {
                "schema": {
                  "$ref": "#/components/schemas/GetOpenOrdersDetailsResponse"
                }
              },
              "application/xml": {
                "schema": {
                  "$ref": "#/components/schemas/GetOpenOrdersDetailsResponse"
                }
              },
              "text/xml": {
                "schema": {
                  "$ref": "#/components/schemas/GetOpenOrdersDetailsResponse"
                }
              }
            }
          }
        },
        "security": [
          {
            "token": [
              "token"
            ]
          }
        ]
      }
    }
  },
  "servers": [
    {
      "url": "https://eu-ext.linnworks.net"
    }
  ],
  "components": {
    "securitySchemes": {
      "token": {
        "type": "apiKey",
        "description": "Authorization Header",
        "name": "Authorization",
        "in": "header"
      }
    },
    "schemas": {
      "OrderGeneralInfo": {
        "description": "Order General Info class",
        "type": "object",
        "properties": {
          "Status": {
            "format": "int32",
            "description": "Order Status (0 = UNPAID, 1 = PAID,2 = RETURN,3 = PENDING,4 = RESEND)",
            "type": "integer"
          },
          "LabelPrinted": {
            "description": "Is label printed",
            "type": "boolean"
          },
          "LabelError": {
            "description": "Is there a label error",
            "type": "string"
          },
          "InvoicePrinted": {
            "description": "Is invoice printed",
            "type": "boolean"
          },
          "InvoicePrintError": {
            "description": "Is there invoice print error",
            "type": "string"
          },
          "PickListPrinted": {
            "description": "Is pick list printed",
            "type": "boolean"
          },
          "PickListPrintError": {
            "description": "Is there pick list print error",
            "type": "string"
          },
          "IsRuleRun": {
            "description": "If rules engine rule ran on an order",
            "type": "boolean"
          },
          "Notes": {
            "format": "int32",
            "description": "Quantity of order notes",
            "type": "integer"
          },
          "PartShipped": {
            "description": "If order partly shipped",
            "type": "boolean"
          },
          "Marker": {
            "format": "int32",
            "description": "Order marker (0 = NOT TAG,1 = Tag 1,2 = Tag 2,3 = Tag 3,4 = Tag 4,5 = Tag 5,6 = Tag 6,7 = Parked)",
            "type": "integer"
          },
          "IsParked": {
            "description": "Is the order parked?",
            "type": "boolean"
          },
          "Identifiers": {
            "description": "Order identifiers. [Prime | Scheduled]",
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Identifier"
            }
          },
          "ReferenceNum": {
            "description": "Order reference number (Channel defined)",
            "type": "string"
          },
          "SecondaryReference": {
            "description": "An additional reference number for the orderr (Used by some channels)",
            "type": "string"
          },
          "ExternalReferenceNum": {
            "description": "This is an additional reference number from the sales channel, typically used by eBay",
            "type": "string"
          },
          "ReceivedDate": {
            "format": "date-time",
            "description": "The date and time at which the order was placed on the sales channel",
            "type": "string"
          },
          "Source": {
            "description": "Order ChannelName/Source (e.g. EBAY)",
            "type": "string"
          },
          "SubSource": {
            "description": "Order Subsource (e.g. EBAY1)",
            "type": "string"
          },
          "SiteCode": {
            "description": "SiteCode used to differentiate between different sites from a single channel (eg. Amazon UK, Amazon US, Amazon FR...)",
            "type": "string"
          },
          "HoldOrCancel": {
            "description": "This shows whether the order has been marked as on hold, for processed orders if the order has been cancelled OnHold = 1",
            "type": "boolean"
          },
          "DespatchByDate": {
            "format": "date-time",
            "description": "Despatch by Date",
            "type": "string"
          },
          "ScheduledDelivery": {
            "$ref": "#/components/schemas/ScheduledDelivery"
          },
          "HasScheduledDelivery": {
            "type": "boolean",
            "readOnly": true
          },
          "Location": {
            "format": "uuid",
            "description": "Order location ID",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "NumItems": {
            "format": "int32",
            "description": "Quantity of order items",
            "type": "integer"
          },
          "PickwaveIds": {
            "description": "All related Pickwave Ids",
            "type": "array",
            "items": {
              "format": "int32",
              "type": "integer"
            }
          },
          "PIIRedactionDays": {
            "format": "int32",
            "description": "Number of days after which an order is processed its pii will be redacted/obfuscate",
            "type": "integer"
          },
          "StockAllocationType": {
            "enum": [
              "NotAllocated",
              "Insuffient",
              "Partial",
              "Full",
              "OverAllocated"
            ],
            "type": "string"
          }
        }
      },
      "OrderShippingInfo": {
        "type": "object",
        "properties": {
          "Vendor": {
            "description": "Courier name (e.g. Royal Mail)",
            "type": "string"
          },
          "PostalServiceId": {
            "format": "uuid",
            "description": "Postal service ID",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "PostalServiceName": {
            "description": "Postal service name (e.g. Next day delivery)",
            "type": "string"
          },
          "TotalWeight": {
            "format": "double",
            "description": "Order total weight",
            "type": "number"
          },
          "ItemWeight": {
            "format": "double",
            "description": "If order is processed",
            "type": "number"
          },
          "PackageCategoryId": {
            "format": "uuid",
            "description": "Package category ID",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "PackageCategory": {
            "description": "Package category name",
            "type": "string"
          },
          "PackageTypeId": {
            "format": "uuid",
            "description": "Package type ID",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "PackageType": {
            "description": "Package type name",
            "type": "string"
          },
          "PostageCost": {
            "format": "double",
            "description": "Order postage cost",
            "type": "number"
          },
          "PostageCostExTax": {
            "format": "double",
            "description": "Order postage cost excluding tax",
            "type": "number"
          },
          "TrackingNumber": {
            "description": "Order tracking number provided by courier",
            "type": "string"
          },
          "ManualAdjust": {
            "description": "If there is an adjustment to shipping cost was made",
            "type": "boolean"
          }
        }
      },
      "OrderCustomerInfo": {
        "type": "object",
        "properties": {
          "ChannelBuyerName": {
            "description": "Username of customer (Comes from channel)",
            "type": "string"
          },
          "Address": {
            "$ref": "#/components/schemas/CustomerAddress"
          },
          "BillingAddress": {
            "$ref": "#/components/schemas/CustomerAddress"
          }
        }
      },
      "OrderTotalsInfo": {
        "type": "object",
        "properties": {
          "Subtotal": {
            "format": "double",
            "description": "Order subtotal",
            "type": "number"
          },
          "PostageCost": {
            "format": "double",
            "description": "Order postage cost",
            "type": "number"
          },
          "PostageCostExTax": {
            "format": "double",
            "description": "Order postage cost ex. tax",
            "type": "number"
          },
          "Tax": {
            "format": "double",
            "description": "Tax",
            "type": "number"
          },
          "TotalCharge": {
            "format": "double",
            "description": "Total charge",
            "type": "number"
          },
          "PaymentMethod": {
            "description": "Payment method",
            "type": "string"
          },
          "PaymentMethodId": {
            "format": "uuid",
            "description": "Payment method ID",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "ProfitMargin": {
            "format": "double",
            "description": "Profit margin",
            "type": "number",
            "readOnly": true
          },
          "TotalDiscount": {
            "format": "double",
            "description": "Total discount applied to the order",
            "type": "number"
          },
          "Currency": {
            "description": "Order currency",
            "type": "string"
          },
          "CountryTaxRate": {
            "format": "double",
            "description": "Country tax rate",
            "type": "number"
          },
          "ConversionRate": {
            "format": "double",
            "description": "Currency conversion rate. Set at point of save by the currency",
            "type": "number"
          }
        }
      },
      "OrderItem": {
        "description": "Order item object",
        "type": "object",
        "properties": {
          "ItemId": {
            "format": "uuid",
            "description": "Stock Item ID",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "ItemNumber": {
            "description": "Item number as on channel",
            "type": "string"
          },
          "SKU": {
            "description": "Product SKU",
            "type": "string"
          },
          "ItemSource": {
            "description": "Item source / channel name",
            "type": "string"
          },
          "Title": {
            "description": "Item title",
            "type": "string"
          },
          "Quantity": {
            "format": "int32",
            "description": "Quantity",
            "type": "integer"
          },
          "CategoryName": {
            "description": "Product category",
            "type": "string"
          },
          "CompositeAvailablity": {
            "format": "int32",
            "description": "Composite availability",
            "type": "integer"
          },
          "StockLevelsSpecified": {
            "description": "If stock level specified",
            "type": "boolean"
          },
          "OnOrder": {
            "format": "int32",
            "description": "Level due in purchase orders",
            "type": "integer"
          },
          "OnPurchaseOrder": {
            "$ref": "#/components/schemas/OrderItemOnOrder"
          },
          "InOrderBook": {
            "format": "int32",
            "description": "Quantity currently in open orders",
            "type": "integer"
          },
          "Level": {
            "format": "int32",
            "description": "Current stock level",
            "type": "integer"
          },
          "MinimumLevel": {
            "format": "int32",
            "description": "Minimum level",
            "type": "integer"
          },
          "AvailableStock": {
            "format": "int32",
            "description": "Currently available stock level (Level-InOrderBook)",
            "type": "integer"
          },
          "PricePerUnit": {
            "format": "double",
            "description": "Unit price",
            "type": "number"
          },
          "UnitCost": {
            "format": "double",
            "description": "Unit cost",
            "type": "number"
          },
          "DespatchStockUnitCost": {
            "format": "double",
            "description": "Despatch stock unit cost",
            "type": "number"
          },
          "Discount": {
            "format": "double",
            "description": "Percentage (0%, 10%, 20%, etc...)",
            "type": "number"
          },
          "Tax": {
            "format": "double",
            "description": "Actual tax value on an item",
            "type": "number",
            "readOnly": true
          },
          "TaxRate": {
            "format": "double",
            "description": "Tax rate",
            "type": "number"
          },
          "Cost": {
            "format": "double",
            "description": "Total item cost (exc tax)",
            "type": "number"
          },
          "CostIncTax": {
            "format": "double",
            "description": "Total item cost (inc tax)",
            "type": "number"
          },
          "CompositeSubItems": {
            "description": "List of order items",
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/OrderItem"
            }
          },
          "IsService": {
            "description": "if item is a service",
            "type": "boolean"
          },
          "SalesTax": {
            "format": "double",
            "description": "Sales Tax",
            "type": "number"
          },
          "TaxCostInclusive": {
            "description": "If tax is included in a cost",
            "type": "boolean"
          },
          "PartShipped": {
            "description": "If order is partly shipped",
            "type": "boolean"
          },
          "Weight": {
            "format": "double",
            "description": "Order weight",
            "type": "number"
          },
          "BarcodeNumber": {
            "description": "Product barcode",
            "type": "string"
          },
          "Market": {
            "format": "int32",
            "description": "Market",
            "type": "integer"
          },
          "ChannelSKU": {
            "description": "Channel product SKU",
            "type": "string"
          },
          "ChannelTitle": {
            "description": "Channel product title",
            "type": "string"
          },
          "DiscountValue": {
            "format": "double",
            "type": "number",
            "readOnly": true
          },
          "HasImage": {
            "description": "If item got an image",
            "type": "boolean",
            "readOnly": true
          },
          "ImageId": {
            "format": "uuid",
            "description": "Image ID",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "AdditionalInfo": {
            "description": "List of order item options",
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/OrderItemOption"
            }
          },
          "StockLevelIndicator": {
            "format": "int32",
            "description": "Stock level indicator",
            "type": "integer"
          },
          "ShippingCost": {
            "format": "double",
            "description": "If batch number scan required",
            "type": "number"
          },
          "PartShippedQty": {
            "format": "int32",
            "description": "ShippingCost",
            "type": "integer"
          },
          "ItemName": {
            "description": "PartShippedQty",
            "type": "string"
          },
          "BatchNumberScanRequired": {
            "description": "ItemName",
            "type": "boolean"
          },
          "SerialNumberScanRequired": {
            "description": "If serial number scan required",
            "type": "boolean"
          },
          "BinRack": {
            "description": "Binrack location",
            "type": "string"
          },
          "BinRacks": {
            "description": "List of BinRacks used for OrderItem",
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/OrderItemBinRack"
            }
          },
          "InventoryTrackingType": {
            "format": "int32",
            "description": "Identifies whether the item has a sell by date or other defined order in which inventory is to be sold",
            "type": "integer"
          },
          "isBatchedStockItem": {
            "description": "If item has batches",
            "type": "boolean",
            "readOnly": true
          },
          "IsWarehouseManaged": {
            "type": "boolean"
          },
          "IsUnlinked": {
            "type": "boolean",
            "readOnly": true
          },
          "StockItemIntId": {
            "format": "int32",
            "type": "integer"
          },
          "Boxes": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/StockItemBoxConfiguration"
            }
          },
          "AddedDate": {
            "format": "date-time",
            "type": "string"
          },
          "RowId": {
            "format": "uuid",
            "description": "Record row ID",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "OrderId": {
            "format": "uuid",
            "description": "Order ID (pkOrderID)",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "StockItemId": {
            "format": "uuid",
            "description": "Stock Item ID",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          }
        }
      },
      "Identifier": {
        "type": "object",
        "properties": {
          "IdentifierId": {
            "format": "int32",
            "description": "Internal identifier id. Use to update image and name.",
            "type": "integer"
          },
          "IsCustom": {
            "description": "Is the tag user or system defined?",
            "type": "boolean"
          },
          "ImageId": {
            "format": "uuid",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "ImageUrl": {
            "type": "string"
          },
          "Tag": {
            "description": "Internal tag for identification purposes",
            "type": "string"
          },
          "Name": {
            "description": "Name displayed where the tag is used",
            "type": "string"
          }
        }
      },
      "ScheduledDelivery": {
        "type": "object",
        "properties": {
          "From": {
            "format": "date-time",
            "type": "string"
          },
          "To": {
            "format": "date-time",
            "type": "string"
          }
        }
      },
      "CustomerAddress": {
        "type": "object",
        "properties": {
          "EmailAddress": {
            "description": "Customer's email address.",
            "type": "string"
          },
          "Address1": {
            "description": "First line of customer address.",
            "type": "string"
          },
          "Address2": {
            "description": "Second line of customer address.",
            "type": "string"
          },
          "Address3": {
            "description": "Third line of customer address.",
            "type": "string"
          },
          "Town": {
            "description": "Customer's town.",
            "type": "string"
          },
          "Region": {
            "description": "Customer's region.",
            "type": "string"
          },
          "PostCode": {
            "description": "Customer's postcode.",
            "type": "string"
          },
          "Country": {
            "description": "Customer's country.",
            "type": "string"
          },
          "Continent": {
            "description": "Customer's continent",
            "type": "string"
          },
          "FullName": {
            "description": "Customer's first and second name.",
            "type": "string"
          },
          "Company": {
            "description": "Customer's company name.",
            "type": "string"
          },
          "PhoneNumber": {
            "description": "Customer's telephone number.",
            "type": "string"
          },
          "CountryId": {
            "format": "uuid",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          }
        }
      },
      "OrderItemOnOrder": {
        "type": "object",
        "properties": {
          "pkPurchaseItemId": {
            "format": "uuid",
            "description": "Primary key of the bound",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "Rowid": {
            "format": "uuid",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "pkPurchaseId": {
            "format": "uuid",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "ExternalInvoiceNumber": {
            "type": "string"
          },
          "fkSupplierId": {
            "format": "uuid",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "DateOfDelivery": {
            "format": "date-time",
            "type": "string"
          },
          "QuotedDeliveryDate": {
            "format": "date-time",
            "type": "string"
          },
          "SupplierName": {
            "type": "string"
          },
          "fkLocationId": {
            "format": "uuid",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          }
        }
      },
      "OrderItemOption": {
        "type": "object",
        "properties": {
          "pkOptionId": {
            "format": "uuid",
            "description": "Option ID",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "Property": {
            "description": "Option property",
            "type": "string"
          },
          "Value": {
            "description": "Value of the option",
            "type": "string"
          }
        }
      },
      "OrderItemBinRack": {
        "description": "OrderItem BinRack",
        "type": "object",
        "properties": {
          "Quantity": {
            "format": "int32",
            "description": "Quantity for BinRack per Location",
            "type": "integer"
          },
          "BinRack": {
            "description": "BinRack",
            "type": "string"
          },
          "Location": {
            "format": "uuid",
            "description": "LocationId of the BinRack",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "BatchId": {
            "format": "int32",
            "description": "If the item is batched, identifies the batch number",
            "type": "integer"
          },
          "OrderItemBatchId": {
            "format": "int32",
            "description": "If the item is batched, identifies the unique order item batch row",
            "type": "integer"
          }
        }
      },
      "StockItemBoxConfiguration": {
        "description": "Stock item box configuration, dimennsions",
        "type": "object",
        "properties": {
          "BoxId": {
            "format": "int32",
            "description": "Unique box id.",
            "type": "integer"
          },
          "StockItemIntId": {
            "format": "int32",
            "description": "",
            "type": "integer"
          },
          "BoxName": {
            "description": "Box name max 16 characters",
            "type": "string"
          },
          "Width": {
            "format": "double",
            "description": "Width of the box",
            "type": "number"
          },
          "Height": {
            "format": "double",
            "description": "Height of the box",
            "type": "number"
          },
          "Length": {
            "format": "double",
            "description": "Depth of the box",
            "type": "number"
          },
          "Weight": {
            "format": "double",
            "description": "Total weight of the box.",
            "type": "number"
          },
          "ValuePercentage": {
            "format": "double",
            "description": "Value break down percentage",
            "type": "number"
          },
          "Barcode": {
            "description": "Box barcode, max 64 characters.",
            "type": "string"
          },
          "PackagingTypeId": {
            "format": "uuid",
            "description": "Packaging type id",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "LogicalDelete": {
            "description": "IsDeleted flag.",
            "type": "boolean"
          }
        }
      },
      "GetOpenOrdersDetailsRequest": {
        "type": "object",
        "properties": {
          "OrderIds": {
            "description": "List of order ids as unique identifiers",
            "type": "array",
            "items": {
              "format": "uuid",
              "type": "string",
              "example": "00000000-0000-0000-0000-000000000000"
            }
          },
          "DetailLevel": {
            "description": "(optional) List of detail level limiters. If the list is null or empty Full details will be returned, as in all detail levels are applied",
            "type": "array",
            "items": {
              "enum": [
                "FOLDER",
                "NOTES",
                "IDENTIFIERS",
                "EXTENDEDPROPERTIES",
                "BINRACKS"
              ],
              "type": "string"
            }
          }
        }
      },
      "GetOpenOrdersDetailsResponse": {
        "type": "object",
        "properties": {
          "Orders": {
            "description": "List of orders",
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/OrderDetails"
            }
          }
        }
      },
      "OrderDetails": {
        "type": "object",
        "properties": {
          "OrderId": {
            "format": "uuid",
            "description": "Order ID (pkOrderId)",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "NumOrderId": {
            "format": "int32",
            "description": "Linnworks order number",
            "type": "integer"
          },
          "Processed": {
            "description": "If order is processed",
            "type": "boolean"
          },
          "ProcessedDateTime": {
            "format": "date-time",
            "description": "Date and time when order was processed",
            "type": "string"
          },
          "FulfilmentLocationId": {
            "format": "uuid",
            "description": "Location ID",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "GeneralInfo": {
            "$ref": "#/components/schemas/OrderGeneralInfo"
          },
          "ShippingInfo": {
            "$ref": "#/components/schemas/OrderShippingInfo"
          },
          "CustomerInfo": {
            "$ref": "#/components/schemas/OrderCustomerInfo"
          },
          "TotalsInfo": {
            "$ref": "#/components/schemas/OrderTotalsInfo"
          },
          "ExtendedProperties": {
            "description": "Extended properties of an order",
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/ExtendedProperty"
            }
          },
          "FolderName": {
            "description": "Folder names assigned to an order",
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "Items": {
            "description": "List of order items",
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/OrderItem"
            }
          },
          "Notes": {
            "description": "List of order notes",
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/OrderNote"
            }
          },
          "PaidDateTime": {
            "format": "date-time",
            "description": "Date and time when the order was marked as paid",
            "type": "string"
          },
          "TaxId": {
            "description": "Buyer's tax number.",
            "type": "string"
          }
        }
      },
      "ExtendedProperty": {
        "type": "object",
        "properties": {
          "RowId": {
            "format": "uuid",
            "description": "Record row ID",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "CreatedDate": {
            "format": "date-time",
            "description": "Date the extended property was created",
            "type": "string"
          },
          "LastUpdatedDate": {
            "format": "date-time",
            "description": "Date the extended property was last updated",
            "type": "string"
          },
          "Name": {
            "description": "Extended property name",
            "type": "string"
          },
          "Value": {
            "description": "Extended property value",
            "type": "string"
          },
          "Type": {
            "description": "Extended property type",
            "type": "string"
          }
        }
      },
      "OrderNote": {
        "type": "object",
        "properties": {
          "OrderNoteId": {
            "format": "uuid",
            "description": "Order note ID",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "OrderId": {
            "format": "uuid",
            "description": "Order Id",
            "type": "string",
            "example": "00000000-0000-0000-0000-000000000000"
          },
          "NoteDate": {
            "format": "date-time",
            "description": "Date and time when note was added",
            "type": "string"
          },
          "Internal": {
            "description": "order note type (Internal or External)",
            "type": "boolean"
          },
          "Note": {
            "description": "Note's text",
            "type": "string"
          },
          "CreatedBy": {
            "description": "User that created note",
            "type": "string"
          },
          "NoteTypeId": {
            "format": "int32",
            "type": "integer"
          }
        }
      }
    }
  }
}
```