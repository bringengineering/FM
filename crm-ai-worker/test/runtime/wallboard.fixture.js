// Local runtime verification only. Never deploy this fixture.
import {wallboardRequest} from '../../src/wallboard-http.js';
export {WallboardDevices} from '../../src/wallboard-devices.js';
export default {fetch(request,env){
 return wallboardRequest(request,env,{verifyIdentity:async token=>token==='local-test-admin'
  ?{uid:'local-admin',email:'admin@example.test',emailVerified:true}:null});
}};
