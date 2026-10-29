import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Build the AEON wordmark and application icons from the supplied brand image.
 *
 * The source is a 94x45 screenshot with a white background and a dark glyph
 * area. We keep only the glyph bounding box, turn ink coverage into alpha, and
 * tint the result for the dark UI. The wordmark's original proportions are
 * preserved everywhere; the square icons letterbox it instead of stretching it.
 */
const source =
  process.env.AEON_LOGO_SOURCE ??
  "C:/Users/suruv/Pictures/Screenshots/Screenshot 2026-10-27 194019.png";
const publicDir = path.resolve("public");
const appDir = path.resolve("src/app");

const { data, info } = await sharp(source)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

let minX = info.width;
let minY = info.height;
let maxX = -1;
let maxY = -1;
for (let y = 0; y < info.height; y += 1) {
  for (let x = 0; x < info.width; x += 1) {
    const index = (y * info.width + x) * info.channels;
    const luminance = (data[index] + data[index + 1] + data[index + 2]) / 3;
    if (luminance < 240) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}

if (maxX < minX || maxY < minY) {
  throw new Error("No AEON wordmark pixels were found in the source image.");
}

const glyphWidth = maxX - minX + 1;
const glyphHeight = maxY - minY + 1;
const rgba = Buffer.alloc(glyphWidth * glyphHeight * 4);
const tint = [236, 253, 245];

for (let y = 0; y < glyphHeight; y += 1) {
  for (let x = 0; x < glyphWidth; x += 1) {
    const sourceIndex = ((minY + y) * info.width + (minX + x)) * info.channels;
    const luminance =
      (data[sourceIndex] + data[sourceIndex + 1] + data[sourceIndex + 2]) / 3;
    const coverage = Math.max(0, Math.min(1, (248 - luminance) / (248 - 24)));
    const target = (y * glyphWidth + x) * 4;
    rgba[target] = tint[0];
    rgba[target + 1] = tint[1];
    rgba[target + 2] = tint[2];
    rgba[target + 3] = Math.round(coverage * 255);
  }
}

const wordmarkScale = 4;
const wordmarkWidth = glyphWidth * wordmarkScale;
const wordmarkHeight = glyphHeight * wordmarkScale;
const wordmark = await sharp(rgba, {
  raw: { width: glyphWidth, height: glyphHeight, channels: 4 },
})
  .resize(wordmarkWidth, wordmarkHeight, { kernel: "lanczos3" })
  .png()
  .toBuffer();

await mkdir(publicDir, { recursive: true });
await sharp(wordmark).toFile(path.join(publicDir, "aeon-wordmark.png"));

async function squareIcon(size, filename) {
  const innerWidth = Math.round(size * 0.78);
  const innerHeight = Math.round((innerWidth * glyphHeight) / glyphWidth);
  const resized = await sharp(wordmark)
    .resize(innerWidth, innerHeight, { kernel: "lanczos3" })
    .png()
    .toBuffer();
  const background = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#050706"/>
  <rect x="${Math.round(size * 0.055)}" y="${Math.round(size * 0.055)}" width="${size - Math.round(size * 0.11)}" height="${size - Math.round(size * 0.11)}" rx="${Math.round(size * 0.2)}" fill="none" stroke="#10b981" stroke-opacity="0.28" stroke-width="${Math.max(2, Math.round(size * 0.008))}"/>
</svg>`;
  await sharp(Buffer.from(background))
    .composite([
      {
        input: resized,
        left: Math.round((size - innerWidth) / 2),
        top: Math.round((size - innerHeight) / 2),
      },
    ])
    .png()
    .toFile(path.join(appDir, filename));
}

await squareIcon(512, "icon.png");
await squareIcon(180, "apple-icon.png");

console.log(
  `AEON wordmark ${glyphWidth}x${glyphHeight} -> ${wordmarkWidth}x${wordmarkHeight}; icons written to src/app`,
);
