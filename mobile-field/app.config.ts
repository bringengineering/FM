import type { ExpoConfig } from 'expo/config';

// Only the local development application is available until native identity,
// attestation and the server facade are enrolled and verified together.
if (process.env.FIELD_APP_ENV && process.env.FIELD_APP_ENV !== 'development') {
  throw new Error('FIELD_RELEASE_NOT_READY: native identity and server enrollment required');
}

const config: ExpoConfig = {
  name: 'BRING CARE 현장노트 개발', slug: 'bring-care-field-notes',
  version: '0.1.0', orientation: 'portrait', userInterfaceStyle: 'light',
  scheme: 'bring-field-dev',
  ios: { bundleIdentifier: 'kr.co.bringengineering.fieldnotes.dev', supportsTablet: true },
  android: { package: 'kr.co.bringengineering.fieldnotes.dev', allowBackup: false,
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'] },
  web: { bundler: 'metro' },
  plugins: [
    'expo-status-bar',
    ['expo-camera', { cameraPermission: '작업 전후 사진 촬영에 카메라를 사용합니다.', recordAudioAndroid: false }],
    ['expo-image-picker', { photosPermission: '선택한 작업사진을 보고서에 추가합니다.', microphonePermission: false, cameraPermission: '작업 전후 사진 촬영에 카메라를 사용합니다.' }],
    ['expo-sqlite', { useSQLCipher: true }],
    ['expo-secure-store', { configureAndroidBackup: true }],
    './plugins/with-private-storage.cjs'
  ],
  extra: { fieldMode: 'development', companyPhone: '1551-3873' },
};
export default config;
