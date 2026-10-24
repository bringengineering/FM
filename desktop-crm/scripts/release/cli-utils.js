"use strict";

const path = require("node:path");

const { releaseError } = require("./release-lib");

function parseArgs(argv, allowed) {
  const result = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--") || !allowed.includes(token.slice(2))) {
      throw releaseError("CRM_RELEASE_ARGUMENT_INVALID", `Unknown release argument: ${token}`);
    }
    const key = token.slice(2);
    if (Object.prototype.hasOwnProperty.call(result, key)) throw releaseError("CRM_RELEASE_ARGUMENT_INVALID", `Duplicate release argument: ${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw releaseError("CRM_RELEASE_ARGUMENT_INVALID", `Missing value for ${token}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function required(args, key, fallback = "") {
  const value = String(args[key] ?? fallback ?? "").trim();
  if (!value) throw releaseError("CRM_RELEASE_ARGUMENT_REQUIRED", `Missing required release argument: --${key}`);
  return value;
}

function resolveWithin(base, value, label) {
  const root = path.resolve(base);
  const target = path.resolve(root, value);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw releaseError("CRM_RELEASE_PATH_INVALID", `${label} must stay inside ${root}.`);
  }
  return target;
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function fail(error) {
  const code = error && error.code || "CRM_RELEASE_FAILED";
  const message = error && error.message || String(error);
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
}

module.exports = { parseArgs, required, resolveWithin, printResult, fail };
