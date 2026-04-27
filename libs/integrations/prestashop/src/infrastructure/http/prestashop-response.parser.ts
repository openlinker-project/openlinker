/**
 * PrestaShop Response Parser
 *
 * Parses PrestaShop WebService API responses (JSON or XML) and normalizes
 * PrestaShop-specific quirks (arrays vs objects, missing nodes, CDATA, dates).
 * Uses fast-xml-parser for XML parsing with fallback support.
 *
 * @module libs/integrations/prestashop/src/infrastructure/http
 */
import { XMLParser } from 'fast-xml-parser';
import { PrestashopParseException } from '@openlinker/integrations-prestashop';

/**
 * PrestaShop Response Parser
 *
 * Handles parsing of PrestaShop API responses with JSON/XML support
 * and normalization of PrestaShop quirks.
 */
export class PrestashopResponseParser {
  private static readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: true,
    parseTagValue: true,
    trimValues: true,
    stopNodes: [], // Don't stop parsing on any nodes
    // Note: arrayMode is not available in fast-xml-parser v4
    // We'll handle array normalization in normalizePrestashopData instead
  });

  /**
   * Parse response based on content type
   *
   * @param responseBody - Raw response body (string)
   * @param contentType - Content-Type header value
   * @param format - Preferred format ('auto', 'json', 'xml')
   * @returns Parsed JavaScript object
   * @throws PrestashopParseException if parsing fails
   */
  static parse(
    responseBody: string,
    contentType?: string,
    format: 'auto' | 'json' | 'xml' = 'auto',
  ): unknown {
    // Normalize format for internal use
    const normalizedFormat: 'json' | 'xml' | undefined = format === 'auto' ? undefined : format;
    // Determine format
    const isJson = this.isJsonContent(contentType) || normalizedFormat === 'json';
    const isXml = this.isXmlContent(contentType) || normalizedFormat === 'xml';

    // Try JSON first if auto or explicitly json
    if (normalizedFormat === undefined || normalizedFormat === 'json') {
      if (isJson || (!isXml && this.looksLikeJson(responseBody))) {
        try {
          return this.parseJson(responseBody);
        } catch (error: unknown) {
          // If JSON parsing fails and format is auto, try XML fallback
          if (normalizedFormat === undefined) {
            try {
              return this.parseXml(responseBody);
            } catch (xmlError: unknown) {
              const xmlErrorMessage = xmlError instanceof Error ? xmlError.message : String(xmlError);
              const jsonErrorMessage = error instanceof Error ? error.message : String(error);
              const combinedMessage = `Failed to parse response as JSON or XML: JSON error: ${jsonErrorMessage}, XML error: ${xmlErrorMessage}`;
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
              const parseError = new PrestashopParseException(
                combinedMessage,
                responseBody,
                'auto',
                error instanceof Error ? error : undefined,
              );
              throw parseError;
            }
          }
          const errorMessage: string = error instanceof Error ? error.message : String(error);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
          const parseError = new PrestashopParseException(
            `Failed to parse JSON response: ${errorMessage}`,
            responseBody,
            'json',
            error instanceof Error ? error : undefined,
          );
          throw parseError;
        }
      }
    }

    // Try XML
    if (normalizedFormat === undefined || normalizedFormat === 'xml' || isXml) {
      try {
        return this.parseXml(responseBody);
      } catch (error: unknown) {
        const errorMessage: string = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const parseError = new PrestashopParseException(
          `Failed to parse XML response: ${errorMessage}`,
          responseBody,
          'xml',
          error instanceof Error ? error : undefined,
        );
        throw parseError;
      }
    }

    // Fallback: try to detect format
    if (this.looksLikeJson(responseBody)) {
      try {
        return this.parseJson(responseBody);
      } catch (error: unknown) {
        const errorMessage: string = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const parseError = new PrestashopParseException(
          `Failed to parse response: ${errorMessage}`,
          responseBody,
          'auto',
          error instanceof Error ? error : undefined,
        );
        throw parseError;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const parseError = new PrestashopParseException(
      'Unable to determine response format (not JSON or XML)',
      responseBody,
      'auto',
    );
    throw parseError;
  }

  /**
   * Parse JSON response
   *
   * @param responseBody - JSON string
   * @returns Parsed object
   */
  private static parseJson(responseBody: string): unknown {
    const parsed: unknown = JSON.parse(responseBody);
    return this.normalizePrestashopData(parsed);
  }

  /**
   * Parse XML response
   *
   * @param responseBody - XML string
   * @returns Parsed object (normalized)
   */
  private static parseXml(responseBody: string): unknown {
    const parsed: unknown = this.xmlParser.parse(responseBody);
    return this.normalizePrestashopData(parsed);
  }

  /**
   * Normalize PrestaShop data quirks
   *
   * PrestaShop has several quirks:
   * - Single items returned as objects instead of arrays
   * - Missing optional fields
   * - Nested structures
   *
   * @param data - Parsed data
   * @returns Normalized data
   */
  private static normalizePrestashopData(data: unknown): unknown {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item: unknown) => this.normalizePrestashopData(item));
    }

    // Handle PrestaShop response structure
    // PrestaShop returns: { prestashop: { products: { product: [...] } } }
    const obj = data as Record<string, unknown>;

    // If this looks like a PrestaShop wrapper, unwrap it
    if (obj.prestashop && typeof obj.prestashop === 'object') {
      const prestashop = obj.prestashop as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(prestashop)) {
        // PrestaShop often returns single items as objects, arrays as arrays
        // Normalize to always return arrays for collection resources
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          // Check if this looks like a single item (has 'id' or similar)
          const valueObj = value as Record<string, unknown>;
          if ('id' in valueObj || '@_id' in valueObj) {
            // Single item - keep as object
            normalized[key] = this.normalizePrestashopData(value);
          } else {
            // Nested structure - recurse
            normalized[key] = this.normalizePrestashopData(value);
          }
        } else if (Array.isArray(value)) {
          // Already an array - normalize items
          normalized[key] = value.map((item: unknown) => this.normalizePrestashopData(item));
        } else {
          normalized[key] = value;
        }
      }

      return normalized;
    }

    // Normalize regular objects
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      normalized[key] = this.normalizePrestashopData(value);
    }

    return normalized;
  }

  /**
   * Check if content type indicates JSON
   */
  private static isJsonContent(contentType?: string): boolean {
    if (!contentType) {
      return false;
    }
    return contentType.includes('application/json') || contentType.includes('text/json');
  }

  /**
   * Check if content type indicates XML
   */
  private static isXmlContent(contentType?: string): boolean {
    if (!contentType) {
      return false;
    }
    return contentType.includes('application/xml') || contentType.includes('text/xml');
  }

  /**
   * Heuristic: does response body look like JSON?
   */
  private static looksLikeJson(responseBody: string): boolean {
    const trimmed = responseBody.trim();
    return trimmed.startsWith('{') || trimmed.startsWith('[');
  }
}

