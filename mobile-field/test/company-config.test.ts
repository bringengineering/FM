import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { companyConfig, buildIdentity } = require('../config/company.cjs');
it('leaves sample builds without company identity and rejects unspecified connection modes', () => {
  expect(companyConfig({}, '.')).toBeNull(); expect(() => companyConfig({ FIELD_CONNECTION: 'other' }, '.')).toThrow('FIELD_CONNECTION_INVALID');
  expect(() => companyConfig({ FIELD_CONNECTION: 'company' }, 'not-present')).toThrow('FIELD_NATIVE_CONFIG_REQUIRED');
});
it('requires matching company project, package/bundle, project number and platform identities', () => {
  const dir = mkdtempSync(join(tmpdir(), 'field-config-'));
  try {
    const google = { project_info: { project_id: 'bring-fm', project_number: '123' }, client: [{ client_info: { mobilesdk_app_id: '1:123:android:abc', android_client_info: { package_name: 'kr.co.bringengineering.fieldnotes.dev' } } }] };
    const plist = '<plist><key>PROJECT_ID</key><string>bring-fm</string><key>BUNDLE_ID</key><string>kr.co.bringengineering.fieldnotes.dev</string><key>GOOGLE_APP_ID</key><string>1:123:ios:def</string></plist>';
    writeFileSync(join(dir, 'google-services.json'), JSON.stringify(google)); writeFileSync(join(dir, 'GoogleService-Info.plist'), plist);
    const env = { FIELD_CONNECTION: 'company', FIELD_COMPANY_CONFIG_DIR: dir };
    expect(companyConfig(env, '.').nativeAppIds).toEqual(['1:123:android:abc', '1:123:ios:def']);
    const fileEnv = { FIELD_CONNECTION: 'company', FIELD_COMPANY_CONFIG_DIR: 'not-present', FIELD_ANDROID_CONFIG_FILE: join(dir, 'google-services.json'), FIELD_IOS_CONFIG_FILE: join(dir, 'GoogleService-Info.plist') };
    expect(companyConfig(fileEnv, '.').nativeAppIds).toEqual(['1:123:android:abc', '1:123:ios:def']);
    google.project_info.project_id = 'other'; writeFileSync(join(dir, 'google-services.json'), JSON.stringify(google)); expect(() => companyConfig(env, '.')).toThrow('FIELD_NATIVE_CONFIG_REQUIRED');
    google.project_info.project_id = 'bring-fm'; writeFileSync(join(dir, 'google-services.json'), JSON.stringify(google));
    writeFileSync(join(dir, 'GoogleService-Info.plist'), plist.replace('1:123:', '1:456:')); expect(() => companyConfig(env, '.')).toThrow('FIELD_NATIVE_CONFIG_REQUIRED');
  } finally { unlinkSync(join(dir, 'google-services.json')); unlinkSync(join(dir, 'GoogleService-Info.plist')); rmdirSync(dir); }
});
it('blocks company cloud builds without an explicit owner/project, but allows local sample and company configuration', () => {
  expect(buildIdentity({})).toEqual({});
  expect(() => buildIdentity({ EAS_BUILD_PROFILE: 'company-preview' })).toThrow('FIELD_EAS_LINK_REQUIRED');
  expect(() => buildIdentity({ FIELD_REQUIRE_EAS_LINK: 'true' })).toThrow('FIELD_EAS_LINK_REQUIRED');
  expect(() => buildIdentity({ FIELD_EXPO_OWNER: 'https://wrong.invalid' })).toThrow('FIELD_EXPO_OWNER_INVALID');
  expect(() => buildIdentity({ FIELD_EAS_PROJECT_ID: 'wrong' })).toThrow('FIELD_EAS_PROJECT_INVALID');
  expect(buildIdentity({ FIELD_EXPO_OWNER: 'synthetic-team', FIELD_EAS_PROJECT_ID: '00000000-0000-0000-0000-000000000001', EAS_BUILD_PROFILE: 'company-preview' }))
    .toEqual({ owner: 'synthetic-team', projectId: '00000000-0000-0000-0000-000000000001' });
});
