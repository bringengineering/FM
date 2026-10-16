import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "public", "field-icons");

const iconSvg = (size) => `
  <svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="56" y1="32" x2="452" y2="480" gradientUnits="userSpaceOnUse">
        <stop stop-color="#2879F0"/>
        <stop offset="1" stop-color="#0B3F83"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="118" fill="#0B2342"/>
    <path d="M124 104C124 81.9 141.9 64 164 64H348C370.1 64 388 81.9 388 104V368C388 390.1 370.1 408 348 408H274L192 464V408H164C141.9 408 124 390.1 124 368V104Z" fill="url(#bg)"/>
    <path d="M197 151H272C320.2 151 348 172.2 348 207.5C348 231.6 334.5 248.2 313.7 256.6C340.4 263.8 356 283 356 310.6C356 350.1 325.7 373 274.3 373H197V151ZM268.8 239.8C289.9 239.8 301.4 231.1 301.4 215.7C301.4 200.9 290.5 193 269.1 193H243.2V239.8H268.8ZM274 331C297.4 331 309.4 321.7 309.4 305.1C309.4 288.5 297.1 279.8 273.7 279.8H243.2V331H274Z" fill="white"/>
  </svg>`;

await fs.mkdir(outputDirectory, { recursive: true });

for (const size of [192, 512]) {
  await sharp(Buffer.from(iconSvg(size))).png().toFile(path.join(outputDirectory, `icon-${size}.png`));
}

console.log(`Generated BRING FIELD icons in ${outputDirectory}`);
