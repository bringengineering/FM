import path from "node:path";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const sourceRoot = process.env.BRING_CREDENTIALS_ROOT;
const smallBusinessSource = process.env.BRING_SMALL_BUSINESS_PNG;

if (!sourceRoot || !smallBusinessSource) {
  throw new Error("BRING_CREDENTIALS_ROOT and BRING_SMALL_BUSINESS_PNG are required.");
}

const outputRoot = path.resolve("public/landing/credentials");
const awardsRoot = path.join(outputRoot, "awards");
const certificationsRoot = path.join(outputRoot, "certifications");
await mkdir(awardsRoot, { recursive: true });
await mkdir(certificationsRoot, { recursive: true });

const awards = [
  ["001_상장/솔버톤 우수상.png", "solverthon-excellence.webp"],
  ["001_상장/솔버톤 임팩트상.png", "solverthon-impact.webp"],
  ["001_상장/예비창업패키지 우수청년창업가상.jpg", "prestartup-excellent-founder.webp"],
  ["001_상장/강원대학교 창업중심대학 혁신창업리그 우수상.png", "knu-innovation-league.webp"],
  ["001_상장/창업보육센터BI 협력가치상.jpg", "gangwon-bi-cooperation.webp"],
  ["002_수료증/한라대학교 원주시 창업가 양성 가속화 프로젝트 수료증.png", "wonju-founder-accelerator.webp"],
];

for (const [source, fileName] of awards) {
  const input = path.join(sourceRoot, source);
  let pipeline = sharp(input)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true });

  if (fileName === "wonju-founder-accelerator.webp") {
    pipeline = pipeline.composite([{
      input: {
        create: {
          width: 500,
          height: 145,
          channels: 3,
          background: "#ffffff",
        },
      },
      left: 125,
      top: 395,
    }]);
  }

  await pipeline
    .webp({ quality: 82, effort: 5 })
    .toFile(path.join(awardsRoot, fileName));
}

await sharp(smallBusinessSource)
  .rotate()
  .flatten({ background: "#ffffff" })
  .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
  .webp({ quality: 82, effort: 5 })
  .toFile(path.join(certificationsRoot, "small-business.webp"));

console.log(`Prepared ${awards.length + 1} credential images in ${outputRoot}`);
