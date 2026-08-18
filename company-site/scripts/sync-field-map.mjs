import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const companySite = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(companySite, "..");
const publicDirectory = resolve(companySite, "public");

const files = [
  ["wonju-map.html", "wonju-map.html"],
  ["data/building-maintenance-companies.js", "data/building-maintenance-companies.js"],
  ["data/field-map-model.js", "data/field-map-model.js"],
];

for (const [source, destination] of files) {
  const output = resolve(publicDirectory, destination);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(resolve(repository, source), output);
}

console.log(`Synced ${files.length} BRING map assets into company-site/public.`);
