/**
 * Amazon Product Type Definitions Types (#4181)
 *
 * The subset of Product Type Definitions API v2020-09-01 the publish path
 * reads: the product types of a marketplace, one product type's definition
 * (which links to its JSON Schema), and the part of that schema describing a
 * listing attribute.
 *
 * A listing attribute in the schema is an array of objects; a SIMPLE one
 * carries its value under `items.properties.value`. Attributes shaped
 * otherwise (a value with a unit, nested groups) are not offered as
 * parameters.
 *
 * @module libs/integrations/amazon/src/domain/types
 */

export interface AmazonProductTypeSummary {
  readonly name: string;
  readonly displayName?: string;
  readonly marketplaceIds?: readonly string[];
}

export interface AmazonProductTypeList {
  readonly productTypes: readonly AmazonProductTypeSummary[];
}

export interface AmazonProductTypeDefinition {
  readonly productType: string;
  readonly schema: {
    readonly link: { readonly resource: string; readonly verb: string };
    readonly checksum?: string;
  };
  readonly requirements?: string;
}

export interface AmazonSchemaValue {
  readonly type?: string | readonly string[];
  readonly enum?: readonly (string | number)[];
  readonly enumNames?: readonly string[];
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface AmazonSchemaAttribute {
  readonly title?: string;
  readonly description?: string;
  readonly type?: string;
  readonly maxItems?: number;
  readonly items?: {
    readonly properties?: Readonly<Record<string, AmazonSchemaValue | undefined>>;
  };
}

export interface AmazonProductTypeSchema {
  readonly properties?: Readonly<Record<string, AmazonSchemaAttribute | undefined>>;
  readonly required?: readonly string[];
}
