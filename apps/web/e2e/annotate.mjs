/**
 * Reusable red-annotation helper for tutorial screenshots.
 *
 * Draws red rectangles/ellipses (with an optional arrow pointing at the
 * shape) directly into the page via a temporary `<canvas>` overlay, so
 * `page.screenshot()` bakes the callout in — no manual image-editor pass
 * after capture. Import from any `*-walkthrough.mjs` / `*-proofs.mjs` script.
 *
 * Usage:
 *   import { annotate, clearAnnotations } from './annotate.mjs';
 *   await annotate(page, [{ locator: page.getByRole('button', { name: 'New connection' }) }]);
 *   await page.screenshot({ path: '...', fullPage: true });
 *   await clearAnnotations(page); // before navigating/interacting further
 *
 * Each item: { locator, shape?: 'rect' | 'ellipse', padding?: number, arrow?: boolean }
 * - shape defaults to 'rect'; 'ellipse' suits a single button/pill callout.
 * - arrow draws a short diagonal arrow from outside the top-right corner,
 *   matching the manual-annotation style already used in tutorial docs.
 */

const CANVAS_ID = '__ol_annotation_canvas__';

export async function annotate(page, items) {
  const boxes = [];
  for (const item of items) {
    const box = await item.locator.boundingBox();
    if (!box) continue;
    boxes.push({
      ...box,
      shape: item.shape ?? 'rect',
      padding: item.padding ?? 8,
      arrow: item.arrow ?? false,
    });
  }
  const [scrollX, scrollY] = await page.evaluate(() => [window.scrollX, window.scrollY]);

  await page.evaluate(
    ({ boxes, scrollX, scrollY, canvasId }) => {
      let canvas = document.getElementById(canvasId);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = canvasId;
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '2147483647';
        document.body.appendChild(canvas);
      }
      canvas.width = document.documentElement.scrollWidth;
      canvas.height = document.documentElement.scrollHeight;

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#e11d1d';
      ctx.lineWidth = 3;

      for (const b of boxes) {
        const x = b.x + scrollX - b.padding;
        const y = b.y + scrollY - b.padding;
        const w = b.width + b.padding * 2;
        const h = b.height + b.padding * 2;

        if (b.shape === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(x, y, w, h);
        }

        if (b.arrow) {
          const endX = x + w + 6;
          const endY = y - 6;
          const startX = endX + 70;
          const startY = endY - 70;
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();

          const angle = Math.atan2(endY - startY, endX - startX);
          const headLen = 14;
          ctx.beginPath();
          ctx.moveTo(endX, endY);
          ctx.lineTo(
            endX - headLen * Math.cos(angle - Math.PI / 6),
            endY - headLen * Math.sin(angle - Math.PI / 6),
          );
          ctx.moveTo(endX, endY);
          ctx.lineTo(
            endX - headLen * Math.cos(angle + Math.PI / 6),
            endY - headLen * Math.sin(angle + Math.PI / 6),
          );
          ctx.stroke();
        }
      }
    },
    { boxes, scrollX, scrollY, canvasId: CANVAS_ID },
  );
}

export async function clearAnnotations(page) {
  await page.evaluate((canvasId) => {
    document.getElementById(canvasId)?.remove();
  }, CANVAS_ID);
}
