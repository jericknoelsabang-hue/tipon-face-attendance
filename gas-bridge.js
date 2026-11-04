/* GitHub Pages -> Google Apps Script form bridge.
 * Uses a hidden cross-origin form + iframe so the browser does not need CORS.
 * The server response posts a request-ID-bound message back to this page.
 */
'use strict';
window.TIPONGitHubBridge=(()=>{
  const pending=new Map();
  const PLACEHOLDER='PASTE_YOUR_GOOGLE_APPS_SCRIPT_EXEC_URL_HERE';
  function validExec(value){
    try{
      const u=new URL(String(value||'').trim());
      return u.protocol==='https:'&&u.hostname==='script.google.com'&&/^\/(?:macros|a\/macros\/[A-Za-z0-9.-]+)\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname) ? u.origin+u.pathname : '';
    }catch{return '';}
  }
  function backendUrl(){
    const configured=window.TIPON_CONFIG?.appsScriptUrl;
    const saved=localStorage.getItem('tiponAppsScriptUrl');
    return validExec(configured===PLACEHOLDER?'':configured)||validExec(saved);
  }
  function id(){
    if(globalThis.crypto?.randomUUID)return crypto.randomUUID().replace(/-/g,'');
    const a=new Uint8Array(24);crypto.getRandomValues(a);return Array.from(a,b=>b.toString(16).padStart(2,'0')).join('');
  }
  function input(form,name,value){const x=document.createElement('input');x.type='hidden';x.name=name;x.value=value;form.appendChild(x);}
  function request(payload,timeoutMs=30000){
    return new Promise((resolve,reject)=>{
      const url=backendUrl();
      if(!url){reject(Object.assign(Error('Google Apps Script URL is not configured. Paste the deployed /exec URL into config.js, or open backend-setup.html once on this device.'),{code:'SETUP'}));return;}
      let body;try{body=JSON.stringify(payload);}catch{reject(Object.assign(Error('Invalid request data.'),{code:'FORMAT'}));return;}
      if(body.length>1000000){reject(Object.assign(Error('Request is too large for organization sync.'),{code:'LIMIT'}));return;}
      const requestId=id(),frame=document.createElement('iframe'),form=document.createElement('form');
      frame.name='tp5_'+requestId;frame.hidden=true;frame.tabIndex=-1;frame.setAttribute('aria-hidden','true');
      form.method='POST';form.action=url;form.target=frame.name;form.enctype='application/x-www-form-urlencoded';form.hidden=true;
      input(form,'tp5Bridge','1');input(form,'requestId',requestId);input(form,'payload',body);
      const timer=setTimeout(()=>{cleanup();reject(Object.assign(Error('Google Apps Script did not respond in time. Local records remain saved and will retry automatically.'),{code:'TIMEOUT'}));},timeoutMs);
      function cleanup(){clearTimeout(timer);pending.delete(requestId);setTimeout(()=>{form.remove();frame.remove();},0);}
      pending.set(requestId,{resolve(value){cleanup();resolve(value);},reject(error){cleanup();reject(error);}});
      document.body.append(frame,form);
      try{form.submit();}catch(e){cleanup();reject(Object.assign(Error('Could not open the Google Apps Script connection.'),{code:'NETWORK'}));}
    });
  }
  window.addEventListener('message',event=>{
    const data=event.data;
    if(!data||data.type!=='TIPON_GITHUB_RESPONSE'||data.protocol!=='tipon-org-v5'||typeof data.id!=='string')return;
    const item=pending.get(data.id);if(!item)return;
    const body=data.body;
    if(!body||typeof body!=='object'){item.reject(Object.assign(Error('Unexpected response from Google Apps Script.'),{code:'SERVER'}));return;}
    item.resolve(body);
  });
  return {request,backendUrl,validExec};
})();
