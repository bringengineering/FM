interface RecordValue { [key:string]:unknown; }
function record(value:unknown):value is RecordValue{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export interface RestoreAuthenticatedActor {uid:string;email:string;authTime:number;role:'admin';mustChangePassword:false;}
/** Token/account must come from verified Firebase callable auth and Admin SDK, never request data. */
export function requireRestoreAdministrator({token,account,crm,rnd}:{token:unknown;account:unknown;crm:unknown;rnd:unknown}):RestoreAuthenticatedActor {
 if(!record(token)||!record(account)||!record(crm)||!record(rnd))throw Error('Restore authentication missing');
 const {uid,email,authTime}=token;if(typeof uid!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)||typeof email!=='string'||!email||!Number.isSafeInteger(authTime)||Number(authTime)<=0||account.uid!==uid||account.email!==email||account.disabled!==false)throw Error('Restore authentication invalid');
 const revokedAt=typeof account.tokensValidAfterTime==='string'?Date.parse(account.tokensValidAfterTime):NaN;if(!Number.isFinite(revokedAt)||Number(authTime)*1000<revokedAt)throw Error('Restore login revoked');
 for(const grant of [crm,rnd])if(grant.enabled!==true||grant.email!==email||grant.role!=='admin'||grant.mustChangePassword===true)throw Error('Restore administrator approval required');
 return{uid,email,authTime:Number(authTime),role:'admin',mustChangePassword:false};
}

/** Pass request.auth provided by onCall, never request.data or a decoded unverified JWT. */
export async function authenticateRestoreCallable(verifiedAuth:unknown,dependencies:{getAccount:(uid:string)=>Promise<unknown>;getApprovals:(uid:string)=>Promise<{crm:unknown;rnd:unknown}>}):Promise<RestoreAuthenticatedActor>{
 const auth=structuredClone(verifiedAuth);if(!record(auth)||typeof auth.uid!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(auth.uid)||!record(auth.token)||typeof auth.token.email!=='string'||!auth.token.email||!Number.isSafeInteger(auth.token.auth_time)||Number(auth.token.auth_time)<=0)throw Error('Restore verified callable authentication required');
 const token={uid:auth.uid,email:auth.token.email,authTime:auth.token.auth_time};const [account,approvals]=await Promise.all([dependencies.getAccount(auth.uid),dependencies.getApprovals(auth.uid)]);return requireRestoreAdministrator({token,account,crm:approvals.crm,rnd:approvals.rnd});
}
