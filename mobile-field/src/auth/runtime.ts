import Constants from 'expo-constants';
import { fetch as expoFetch } from 'expo/fetch';
import { FieldError } from '../domain/model';
import { CompanyRecordingApi } from '../api/recording';
import { CompanySession } from './session';
import { createEmployeeIdentity } from './firebase';

export const companyConnectionEnabled = Constants.expoConfig?.extra?.fieldConnection === 'company';
export async function createCompanySession(): Promise<CompanySession> {
  const config = Constants.expoConfig?.extra?.company;
  if (!companyConnectionEnabled || !config || config.projectId !== 'bring-fm'
    || config.apiBase !== 'https://asia-northeast3-bring-fm.cloudfunctions.net/fieldMobileApi/v1/field-app'
    || !Array.isArray(config.nativeAppIds) || config.nativeAppIds.length !== 2
    || !config.nativeAppIds.every((id: unknown) => typeof id === 'string' && /^1:\d+:(android|ios):[a-f0-9]+$/.test(id))) throw new FieldError('NATIVE_APP_NOT_CONFIGURED');
  const identity = await createEmployeeIdentity(config);
  return new CompanySession(identity, uid => new CompanyRecordingApi(config.apiBase, uid, () => identity.credentials(uid), expoFetch as typeof fetch));
}
