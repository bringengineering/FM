const path = require('node:path');
const { companyConfig, buildIdentity } = require('../config/company.cjs');
const root = path.resolve(__dirname, '..');
function inspect(env = process.env) {
  let firebaseFilesMatch = false, expoOwnerConfigured = false, easProjectLinked = false;
  const issues = [];
  try { firebaseFilesMatch = !!companyConfig({ ...env, FIELD_CONNECTION: 'company' }, root); }
  catch { issues.push('FIREBASE_NATIVE_CONFIG_REQUIRED'); }
  try {
    const identity = buildIdentity(env); expoOwnerConfigured = !!identity.owner; easProjectLinked = !!identity.projectId;
    if (!expoOwnerConfigured || !easProjectLinked) issues.push('EXPO_COMPANY_PROJECT_REQUIRED');
  } catch { issues.push('EXPO_COMPANY_PROJECT_REQUIRED'); }
  return { firebaseFilesMatch, expoOwnerConfigured, easProjectLinked,
    profiles: { android: 'company-preview / APK', ios: 'company-preview / registered-device IPA' },
    requiresManualVerification: ['Expo sign-in and build quota', 'Android signing and Play Integrity', 'Apple membership, signing and iPhone registration', 'fieldMobileApi deployment and employee access'],
    issues,
  };
}
module.exports = { inspect };
if (require.main === module) { const result = inspect(); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.issues.length ? 1 : 0; }
