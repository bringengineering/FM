const fs = require('node:fs');
const path = require('node:path');
const packageName = 'kr.co.bringengineering.fieldnotes.dev';
const projectId = 'bring-fm';
const apiBase = 'https://asia-northeast3-bring-fm.cloudfunctions.net/fieldMobileApi/v1/field-app';
function companyConfig(env, root) {
  if (!env.FIELD_CONNECTION || env.FIELD_CONNECTION === 'sample') return null;
  if (env.FIELD_CONNECTION !== 'company') throw Error('FIELD_CONNECTION_INVALID');
  const directory = path.resolve(root, env.FIELD_COMPANY_CONFIG_DIR || 'native-config');
  const android = path.join(directory, 'google-services.json'), ios = path.join(directory, 'GoogleService-Info.plist');
  try {
    const google = JSON.parse(fs.readFileSync(android, 'utf8'));
    const plist = fs.readFileSync(ios, 'utf8');
    const string = key => new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(plist)?.[1];
    const clients = google.client?.filter(item => item.client_info?.android_client_info?.package_name === packageName);
    const androidId = clients?.[0]?.client_info?.mobilesdk_app_id, iosId = string('GOOGLE_APP_ID');
    if (google.project_info?.project_id !== projectId || clients?.length !== 1 || string('PROJECT_ID') !== projectId || string('BUNDLE_ID') !== packageName
      || !/^1:\d+:android:[a-f0-9]+$/.test(androidId || '') || !/^1:\d+:ios:[a-f0-9]+$/.test(iosId || '')
      || androidId.split(':')[1] !== iosId.split(':')[1] || String(google.project_info?.project_number) !== androidId.split(':')[1]) throw Error('INVALID');
    return { android, ios, projectId, nativeAppIds: [androidId, iosId], apiBase };
  } catch { throw Error('FIELD_NATIVE_CONFIG_REQUIRED: matching company Android/iOS configuration files required'); }
}
module.exports = { companyConfig };
