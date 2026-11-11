"use strict";

const fs = require("node:fs");

const { parseVersion, releaseError } = require("./release-lib");
const { fail, parseArgs, printResult, required, resolveWithin } = require("./cli-utils");

function writeCanonicalJson(target, value) {
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2), ["version", "package", "lock"]);
  const cwd = process.cwd();
  const version = parseVersion(required(args, "version")).version;
  const packagePath = resolveWithin(cwd, required(args, "package", "desktop-crm/package.json"), "package.json");
  const lockPath = resolveWithin(cwd, required(args, "lock", "desktop-crm/package-lock.json"), "package-lock.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  if (!lock.packages || !lock.packages[""] || lock.name !== packageJson.name || lock.packages[""].name !== packageJson.name) {
    throw releaseError("CRM_RELEASE_PACKAGE_LOCK_INVALID", "Desktop package-lock root does not match package.json.");
  }
  packageJson.version = version;
  lock.version = version;
  lock.packages[""].version = version;
  writeCanonicalJson(packagePath, packageJson);
  writeCanonicalJson(lockPath, lock);
  printResult({ version, package: packagePath, lock: lockPath });
}

try { main(); } catch (error) { fail(error); }
