import type { EmployeeIdentity } from './session';
import { FieldError } from '../domain/model';
export async function createEmployeeIdentity(_expected: { projectId: string; nativeAppIds: string[] }): Promise<EmployeeIdentity> {
  throw new FieldError('NATIVE_BUILD_REQUIRED');
}
