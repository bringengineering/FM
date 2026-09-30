export class CSVImportAuthorizationError extends Error{
 constructor(public readonly code:'unauthenticated'|'permission-denied',message:string){super(message);this.name='CSVImportAuthorizationError';}
}
interface RecordValue{[key:string]:unknown;}
function record(value:unknown):value is RecordValue{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function writeRole(value:unknown):value is 'member'|'admin'{return value==='member'||value==='admin';}
export interface CSVImportAuthenticatedPublisher{uid:string;email:string;authTime:number;role:'member'|'admin';mustChangePassword:false;}
/** Verified Firebase identity plus fresh Admin SDK account/database values only. Never request-body claims. */
export function requireCSVImportPublisher({token,account,crm,rnd}:{token:unknown;account:unknown;crm:unknown;rnd:unknown}):CSVImportAuthenticatedPublisher{
 if(!record(token)||!record(account))throw new CSVImportAuthorizationError('unauthenticated','CSV publication authentication missing');
 const {uid,email,authTime}=token;
 if(typeof uid!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)||typeof email!=='string'||!email||typeof authTime!=='number'||!Number.isSafeInteger(authTime)||authTime<=0||account.uid!==uid||account.email!==email||account.disabled!==false)throw new CSVImportAuthorizationError('unauthenticated','CSV publication authentication invalid');
 const revokedAt=typeof account.tokensValidAfterTime==='string'?Date.parse(account.tokensValidAfterTime):NaN;
 if(!Number.isFinite(revokedAt)||authTime*1000<revokedAt)throw new CSVImportAuthorizationError('unauthenticated','CSV publication login revoked');
 if(!record(crm)||!record(rnd)||!writeRole(crm.role)||rnd.role!==crm.role)throw new CSVImportAuthorizationError('permission-denied','CSV publication approval required');
 for(const grant of [crm,rnd])if(grant.enabled!==true||grant.email!==email||grant.mustChangePassword===true)throw new CSVImportAuthorizationError('permission-denied','CSV publication approval required');
 return{uid,email,authTime,role:crm.role,mustChangePassword:false};
}
/** Use only request.auth supplied by Firebase onCall. SDK outages propagate for separate handling. */
export async function authenticateCSVImportCallable(verifiedAuth:unknown,dependencies:{getAccount:(uid:string)=>Promise<unknown>;getApprovals:(uid:string)=>Promise<{crm:unknown;rnd:unknown}>}):Promise<CSVImportAuthenticatedPublisher>{
 const auth=structuredClone(verifiedAuth);
 if(!record(auth)||typeof auth.uid!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(auth.uid)||!record(auth.token)||typeof auth.token.email!=='string'||!auth.token.email||typeof auth.token.auth_time!=='number'||!Number.isSafeInteger(auth.token.auth_time)||auth.token.auth_time<=0)throw new CSVImportAuthorizationError('unauthenticated','CSV verified callable authentication required');
 const token={uid:auth.uid,email:auth.token.email,authTime:auth.token.auth_time};
 const [account,approvals]=await Promise.all([dependencies.getAccount(auth.uid),dependencies.getApprovals(auth.uid)]);
 return requireCSVImportPublisher({token,account,crm:approvals.crm,rnd:approvals.rnd});
}
