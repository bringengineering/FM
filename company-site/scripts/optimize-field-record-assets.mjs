import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const sourceRoot = process.env.BRING_RECORD_SOURCE;

if (!sourceRoot) {
  throw new Error("Set BRING_RECORD_SOURCE to the reviewed blog-image directory.");
}

const projectRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(projectRoot, "public", "landing", "records");

const assets = [
  ["224383896443/photo-02-work-start.png", "address-sign-work.jpg"],
  ["224382176899/08_호수판벨커버_개인정보가림.png", "unit-sign.jpg"],
  ["224382176266/07_출입구안내물_개인정보가림.png", "entrance-notices.jpg"],
  ["224382175661/06_디지털사이니지_개인정보가림.png", "digital-signage.jpg"],
  ["224382174945/codex-clipboard-4c6921cd-62a1-445b-a499-dea8f0a84373.jpg", "waste-cleanup.jpg"],
  ["224382174370/codex-clipboard-82502d5e-c1e1-4dca-96e5-c35071d69258.jpg", "defect-check.jpg"],
  ["224382173190/codex-clipboard-dbd622bf-d942-4016-b117-022b790de70b.jpg", "fire-safety-pad.jpg"],
  ["224382172156/20260814_141604.jpg", "tenancy-check.jpg"],
  ["224382169457/codex-clipboard-22e37e96-2622-4dd4-9282-78cbfec612a1.jpg", "vine-overgrowth.jpg"],
  ["224381122777/04-vendor-wall-work.jpg", "grounds-work.jpg"],
  ["224373338080/KakaoTalk_20260809_221705575.jpg", "bulky-waste.jpg"],
  ["224368259003/KakaoTalk_20260804_214821749_02.jpg", "vacancy-check.jpg"],
];

await mkdir(outputRoot, { recursive: true });

for (const [source, output] of assets) {
  await sharp(path.join(sourceRoot, source))
    .rotate()
    .resize(900, 720, { fit: "cover", position: "attention" })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(path.join(outputRoot, output));
}

console.log(`Prepared ${assets.length} reviewed field-record assets.`);
