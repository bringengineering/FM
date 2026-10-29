import type { ExpoConfig } from 'expo/config';
const { companyConfig, buildIdentity } = require('./config/company.cjs');

// Only the local development application is available until native identity,
// attestation and the server facade are enrolled and verified together.
if (process.env.FIELD_APP_ENV && process.env.FIELD_APP_ENV !== 'development') {
  throw new Error('FIELD_RELEASE_NOT_READY: native identity and server enrollment required');
}
const company = companyConfig(process.env, __dirname);
const build = buildIdentity(process.env, require('./config/eas-project.json'));
// Firebase Auth 25 needs Kotlin 2.4. Expo's Pika/modules compiler artifacts exist
// for 2.4.20 (not 2.4.21); 2.4.20 also supports this app's AGP 9.2.1.
const companyPlugins: NonNullable<ExpoConfig['plugins']> = company ? ['@react-native-firebase/app', '@react-native-firebase/auth', '@react-native-firebase/app-check', ['expo-build-properties', { android: { kotlinVersion: '2.4.20' }, ios: { useFrameworks: 'dynamic' } }]] : [];

const config: ExpoConfig = {
  name: 'BRING CARE 현장노트 개발', slug: 'bring-care-field-notes',
  ...(build.owner ? { owner: build.owner } : {}),
  version: '0.1.10', orientation: 'portrait', userInterfaceStyle: 'light',
  scheme: 'bring-field-dev',
  ios: { bundleIdentifier: 'kr.co.bringengineering.fieldnotes.dev', supportsTablet: true, ...(company ? {
    googleServicesFile: company.ios,
    // Firebase App Check accepts App Attest production tokens, including test builds.
    entitlements: { 'com.apple.developer.devicecheck.appattest-environment': 'production' },
  } : {}) },
  android: { package: 'kr.co.bringengineering.fieldnotes.dev', versionCode: 11, allowBackup: false,
    ...(company ? { googleServicesFile: company.android } : {}),
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'] },
  web: { bundler: 'metro' },
  plugins: [
    ...companyPlugins,
    'expo-status-bar',
    ['expo-camera', { cameraPermission: '작업 전후 사진 촬영에 카메라를 사용합니다.', recordAudioAndroid: false }],
    ['expo-image-picker', { photosPermission: '선택한 작업사진을 보고서에 추가합니다.', microphonePermission: false, cameraPermission: '작업 전후 사진 촬영에 카메라를 사용합니다.' }],
    ['expo-sqlite', { useSQLCipher: true }],
    ['expo-secure-store', { configureAndroidBackup: true }],
    './plugins/with-private-storage.cjs'
  ],
  extra: { fieldMode: 'development', fieldConnection: company ? 'company' : 'sample', companyPhone: '1551-3873',
    ...(build.projectId ? { eas: { projectId: build.projectId } } : {}),
    ...(company ? { company: { projectId: company.projectId, nativeAppIds: company.nativeAppIds, apiBase: company.apiBase } } : {}),
  },
};
export default config;
