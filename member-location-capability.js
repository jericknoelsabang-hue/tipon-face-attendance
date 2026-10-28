/* TIPON KABILANG — authoritative Member Location API readiness.
 * The browser cannot add actions to a private Apps Script deployment.
 * Do not silently fall back to editing local members or modifying encrypted
 * biometric templates when the server does not support location-only edits.
 */
'use strict';
window.TIPONMemberLocationSupport=(()=>{
  let last=null;
  async function check({refresh=false}={}){
    const orgId=state.orgId||'';
    if(!refresh&&last?.orgId===orgId&&Date.now()-last.time<30000)return last.supported;
    try{
      const response=await TIPONAPI.raw({action:'memberLocationCapabilities'});
      if(response.orgId&&orgId&&response.orgId!==orgId)
        throw Object.assign(Error('Organization backend changed. Reconnect the correct TIPON organization.'),{code:'ORG'});
      // Existing documented API contract from MemberLocationEdit.gs.
      const supported=response.allowUnassignedFace===true||response.memberLocationUpdate===true;
      last={orgId,time:Date.now(),supported};
      return supported;
    }catch(error){
      const code=String(error?.code||'').toUpperCase();
      if(code==='ACTION'||/unknown action|unsupported action|not implemented/i.test(String(error?.message||''))){
        last={orgId,time:Date.now(),supported:false};
        return false;
      }
      // A network/auth/timeout error is not evidence of absent backend code.
      throw error;
    }
  }
  function clear(){last=null;}
  return {check,clear};
})();