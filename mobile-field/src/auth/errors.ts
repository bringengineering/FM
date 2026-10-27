import { FieldError } from '../domain/model';

// Only fixed codes leave the native SDK boundary. Never expose provider messages,
// custom data, request URLs, credentials, or arbitrary error-code strings.
const loginCodes: Readonly<Record<string, string>> = {
  'auth/invalid-credential': 'LOGIN_FAILED',
  'auth/invalid-login-credentials': 'LOGIN_FAILED',
  'auth/wrong-password': 'LOGIN_FAILED',
  'auth/user-not-found': 'LOGIN_FAILED',
  'auth/invalid-email': 'LOGIN_FAILED',
  'auth/user-disabled': 'LOGIN_ACCOUNT_DISABLED',
  'auth/operation-not-allowed': 'LOGIN_PROVIDER_DISABLED',
  'auth/app-not-authorized': 'LOGIN_APP_NOT_AUTHORIZED',
  'auth/invalid-api-key': 'LOGIN_APP_NOT_AUTHORIZED',
  'auth/missing-client-identifier': 'LOGIN_APP_NOT_AUTHORIZED',
  'auth/invalid-app-credential': 'LOGIN_APP_NOT_AUTHORIZED',
  'auth/network-request-failed': 'NETWORK_UNCERTAIN',
  'auth/too-many-requests': 'RATE_LIMITED',
  'auth/quota-exceeded': 'RATE_LIMITED',
  'auth/internal-error': 'LOGIN_PROVIDER_ERROR',
};
export function safeLoginFailure(error: unknown): FieldError {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return new FieldError(typeof code === 'string' && Object.hasOwn(loginCodes, code) ? loginCodes[code]! : 'LOGIN_PROVIDER_ERROR');
}
