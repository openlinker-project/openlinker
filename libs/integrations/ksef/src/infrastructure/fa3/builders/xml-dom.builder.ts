/**
 * XML DOM Builder (fast-xml-parser wrapper)
 *
 * Thin, escaping-safe XML serialisation seam over `fast-xml-parser`'s
 * `XMLBuilder`. The FA(3) builder constructs a plain JS object tree and hands it
 * here; `XMLBuilder.build` emits a string with every text node and attribute
 * value entity-escaped automatically (`<`, `>`, `&`, `"`, `'`). This is the
 * single defence against XML injection — the FA(3) builder MUST route all
 * user-supplied values (buyer name, address, line names) through this object
 * tree and never hand-concatenate XML strings.
 *
 * `fast-xml-parser` is the in-workspace XML lib (also used by PrestaShop/DPD);
 * no native build, so it works on constrained CI. Well-formedness is checked
 * separately by the validator layer.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/builders
 */
import { XMLBuilder } from 'fast-xml-parser';

/** Attribute key prefix the builder uses for element attributes. */
export const XML_ATTR_PREFIX = '@_' as const;

/** A serialisable XML node tree (objects, arrays, scalars). */
export type XmlNode = string | number | boolean | null | XmlNodeObject | XmlNode[];
export interface XmlNodeObject {
  [key: string]: XmlNode;
}

/**
 * Serialise an XML object tree to a string, with an XML declaration and
 * automatic entity-escaping of all text/attribute values.
 *
 * @param tree Root object — one top-level key naming the root element.
 */
export function serializeXml(tree: XmlNodeObject): string {
  const builder = new XMLBuilder({
    attributeNamePrefix: XML_ATTR_PREFIX,
    ignoreAttributes: false,
    format: false,
    suppressEmptyNode: true,
  });
  const body = builder.build(tree) as string;
  return `<?xml version="1.0" encoding="UTF-8"?>${body}`;
}
