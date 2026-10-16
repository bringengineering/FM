import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

const services = [
  ["building-care", "건물관리"],
  ["stair-cleaning", "건물청소"],
  ["move-in-cleaning", "입주청소"],
];

for (const [slug, name] of services) {
  test(`${name} route exposes canonical metadata and structured search data`, async () => {
    const page = await source(`app/${slug}/page.tsx`);
    assert.match(page, new RegExp(`https://bring-fm\\.web\\.app/${slug}`));
    assert.match(page, /openGraph/);

    const searchData = await source("app/landing/serviceSearchData.ts");
    assert.match(searchData, new RegExp(slug));
    assert.match(searchData, /FAQPage/);
    assert.match(searchData, /BreadcrumbList/);
  });
}

test("crawler discovery files enumerate the three public services", async () => {
  const [robots, sitemap, llms] = await Promise.all([
    source("public/robots.txt"),
    source("public/sitemap.xml"),
    source("public/llms.txt"),
  ]);

  assert.match(robots, /Sitemap: https:\/\/bring-fm\.web\.app\/sitemap\.xml/);
  for (const [slug, name] of services) {
    assert.match(sitemap, new RegExp(`https://bring-fm\\.web\\.app/${slug}`));
    assert.match(llms, new RegExp(`${name}.*https://bring-fm\\.web\\.app/${slug}`, "s"));
  }
});
