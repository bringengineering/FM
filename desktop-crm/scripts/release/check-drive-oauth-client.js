"use strict";

const { normalizeBringFmClientId, normalizeClientId } = require("../../src/drive-oauth");
const { fail, parseArgs, printResult, required } = require("./cli-utils");
const { releaseError } = require("./release-lib");

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, ["client-id"]);
  const clientId = required(args, "client-id");
  if (!normalizeClientId(clientId)) {
    throw releaseError(
      "CRM_DRIVE_OAUTH_CLIENT_INVALID",
      "BRING_CRM_GOOGLE_DRIVE_CLIENT_ID must be a Google OAuth Desktop client ID.",
    );
  }
  if (!normalizeBringFmClientId(clientId)) {
    throw releaseError(
      "CRM_DRIVE_OAUTH_PROJECT_MISMATCH",
      "BRING CRM releases accept only the BRING-FM Google Cloud project's Desktop OAuth client ID.",
    );
  }
  // The client ID is public, but avoid echoing identifiers into release logs.
  const result = { configured: true };
  printResult(result);
  return result;
}

if (require.main === module) {
  try { main(); } catch (error) { fail(error); }
}

module.exports = { main };
