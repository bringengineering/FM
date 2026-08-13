import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const output = path.join(projectRoot, "firebase-public");
const client = path.join(projectRoot, "dist", "client");

if (!output.startsWith(`${projectRoot}${path.sep}`)) {
  throw new Error("Refusing to export outside the project directory.");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(client, output, { recursive: true });

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("firebase-export", `${Date.now()}`);
const { default: worker } = await import(workerUrl.href);
const routes = [
  { pathname: "/", outputFile: "index.html" },
  { pathname: "/consult", outputFile: "consult/index.html" },
  { pathname: "/field", outputFile: "field/index.html" },
  {
    pathname: "/consult/complete",
    outputFile: "consult/complete/index.html",
  },
];

for (const route of routes) {
  const response = await worker.fetch(
    new Request(`https://bring-fm.web.app${route.pathname}`, {
      headers: {
        accept: "text/html",
        host: "bring-fm.web.app",
        "x-forwarded-host": "bring-fm.web.app",
        "x-forwarded-proto": "https",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  if (!response.ok) {
    throw new Error(
      `Static export failed for ${route.pathname} with status ${response.status}.`,
    );
  }

  const target = path.join(output, route.outputFile);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await response.text(), "utf8");
}
console.log(`Firebase static export created at ${output}`);
