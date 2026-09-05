// Crops a screenshot to a content-only region and blacks out rectangles inside it
// (e.g. to redact a real name before a screenshot goes into shipped docs).
// Used to prepare the docs/user-guide/images/04b-*.png set for the sales-documents
// tutorial — kept here as a reusable tool for the next person cutting doc screenshots.
//
// Usage: node crop-and-mask-screenshot.cjs <input.png> <output.png> <cropJSON> <masksJSON>
//   cropJSON:  {"x":0,"y":0,"w":100,"h":100} in ORIGINAL image pixels (omit/null = no crop)
//   masksJSON: [{"x":0,"y":0,"w":10,"h":10}, ...] in CROPPED image pixels (black boxes)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function main() {
  const [, , inputPath, outputPath, cropArg, masksArg] = process.argv;
  const crop = cropArg && cropArg !== 'null' ? JSON.parse(cropArg) : null;
  const masks = masksArg ? JSON.parse(masksArg) : [];
  const buf = fs.readFileSync(inputPath);
  const b64 = buf.toString('base64');

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="c"></canvas>');
    const dataUrl = await page.evaluate(
      ({ b64, crop, masks }) => {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const cw = crop ? crop.w : img.width;
            const ch = crop ? crop.h : img.height;
            const canvas = document.getElementById('c');
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext('2d');
            if (crop) {
              ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, cw, ch);
            } else {
              ctx.drawImage(img, 0, 0);
            }
            ctx.fillStyle = '#111827';
            for (const m of masks) {
              ctx.fillRect(m.x, m.y, m.w, m.h);
            }
            resolve(canvas.toDataURL('image/png'));
          };
          img.src = 'data:image/png;base64,' + b64;
        });
      },
      { b64, crop, masks },
    );

    const outBuf = Buffer.from(dataUrl.split(',')[1], 'base64');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, outBuf);
    console.log('wrote', outputPath, outBuf.length, 'bytes');
  } finally {
    await browser.close();
  }
}
main();
