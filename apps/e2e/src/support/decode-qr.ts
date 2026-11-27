/**
 * Decode a QR code from a screenshot (H-06, DEF-02/03).
 *
 * Reads the code the way a phone would - from pixels - so the assertion is
 * independent of how the app drew it. A test that compared the app's own SVG
 * path to the app's own encoder would prove only that the app agrees with
 * itself.
 *
 * @module support
 */
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import type { Locator } from '@playwright/test';

export async function decodeQrFromLocator(locator: Locator): Promise<string | null> {
  // A white margin keeps the quiet zone intact even if the element is cropped tight.
  const buffer = await locator.screenshot({ scale: 'device', animations: 'disabled' });
  const png = PNG.sync.read(buffer);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return result?.data ?? null;
}
