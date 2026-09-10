"use strict";

const path = require("node:path");

const { expectedAssetNames, verifyReleaseAssets } = require("./release-assets");
const { writeGithubOutput } = require("./release-lib");
const { fail, parseArgs, printResult, required, resolveWithin } = require("./cli-utils");

function main() {
  const args = parseArgs(process.argv.slice(2), ["version", "dist"]);
  const cwd = process.cwd();
  const version = required(args, "version");
  const dist = resolveWithin(cwd, required(args, "dist", "desktop-crm/dist"), "release asset directory");
  const result = verifyReleaseAssets(expectedAssetNames(version).map(name => path.join(dist, name)), version);
  const output = {
    version: result.version,
    installer: result.installer.path,
    blockmap: result.blockmap.path,
    manifest: result.manifest.path,
    installer_sha512: result.installer.sha512,
  };
  writeGithubOutput(output);
  printResult(output);
}

try { main(); } catch (error) { fail(error); }
