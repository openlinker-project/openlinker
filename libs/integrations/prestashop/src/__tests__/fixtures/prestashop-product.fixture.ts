/**
 * PrestaShop Product Fixtures
 *
 * Sample PrestaShop product responses for testing (JSON and XML formats).
 *
 * @module libs/integrations/prestashop/src/__tests__/fixtures
 */
// eslint-disable-next-line no-restricted-imports
import { PrestashopProduct } from '../../infrastructure/mappers/prestashop.mapper.interface';

export const samplePrestashopProduct: PrestashopProduct = {
  id: '1',
  name: {
    language: [
      { '#text': 'Test Product', '@_id': '1' },
    ],
  },
  description: {
    language: [
      { '#text': 'Test Description', '@_id': '1' },
    ],
  },
  reference: 'TEST-001',
  price: '19.99',
  weight: '0.5',
  active: '1',
  associations: {
    categories: {
      category: [{ id: '5' }, { id: '10' }],
    },
  },
};

export const samplePrestashopProductJson = JSON.stringify({
  prestashop: {
    products: {
      product: [samplePrestashopProduct],
    },
  },
});

export const samplePrestashopProductXml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <products>
    <product id="1">
      <name><language id="1"><![CDATA[Test Product]]></language></name>
      <reference><![CDATA[TEST-001]]></reference>
      <price>19.99</price>
      <weight>0.5</weight>
      <active>1</active>
    </product>
  </products>
</prestashop>`;

