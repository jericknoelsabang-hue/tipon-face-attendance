/* Shared business-platform dropdowns. Only admins can add centrally approved labels.
 * This module never widens a staff account's assigned cooperative/platform scope.
 */
'use strict';
window.TIPONPlatforms=(()=>{
  const selectors=['sitePlatform','officePlatform','registerPlatform','migrationPlatform'];
  let target='',busy=false;
  function names(){
    return TIPONOrgCore.platformNames([...(TIPONOrgCore.DEFAULT_PLATFORMS||[]),...(state.platforms||[]),...(state.sites||[]).map(s=>s.platform),...(state.offices||[]).filter(o=>o.orgId===state.orgId).map(o=>o.platform),state.user?.platform||'']);
  }
  function fill(id,preferred){
    const el=$(id);if(!el)return;
    const value=preferred===undefined?el.value:String(preferred||'');
    const scoped=state.user?.role==='registrar'&&['sitePlatform','officePlatform'].includes(id);
    const options=scoped?[state.user.platform]:TIPONOrgCore.platformNames([...names(),value]);
    const html='<option value="">Select business platform</option>'+options.filter(Boolean).map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
    if(el.innerHTML!==html)el.innerHTML=html;el.disabled=scoped;
    el.value=scoped?state.user.platform:value;
  }
  function render(){
    selectors.forEach(id=>fill(id));
    if($('platformChips'))$('platformChips').innerHTML=names().map(n=>`<span class="platform-chip">${esc(n)}</span>`).join('');
    document.querySelectorAll('[data-add-platform-for]').forEach(b=>b.hidden=!isAdmin());
  }
  async function load(){
    const saved=await getOne('meta','tp51-platforms:'+state.orgId);
    state.platforms=saved?.names||[];render();
  }
  async function accept(values){
    state.platforms=TIPONOrgCore.platformNames(values);
    if(state.orgId&&state.user)await OrgDB.rawSave('meta',{id:'tp51-platforms:'+state.orgId,names:state.platforms,updatedAt:new Date().toISOString()});
    render();
  }
  async function refresh(){
    if(!navigator.onLine){render();return;}
    const response=await TIPONAPI.raw({action:'platforms'});
    if(state.user&&response.orgId!==state.orgId)throw Error('The organization destination changed. Reconnect with the system owner.');
    await accept(response.businessPlatforms||[]);
  }
  function open(id){
    if(!isAdmin()){showToast('The administrator manages business-platform names. Your assigned scope is unchanged.','info');return;}
    target=id||'';$('platformForm').reset();setText('platformStatus','');$('platformDialog').showModal();$('newPlatformName').focus();
  }
  async function save(event){
    event.preventDefault();if(busy||!isAdmin())return;
    if(!navigator.onLine){setText('platformStatus','Internet is required to add a shared platform. Existing dropdown options remain usable offline.');return;}
    busy=true;$('savePlatform').disabled=true;setText('platformStatus','Saving business platform...');
    try{
      const response=await TIPONAPI.call({action:'platformAdd',name:$('newPlatformName').value.trim()});
      await accept(response.businessPlatforms||[]);
      if(target){fill(target,response.platformName);$(target)?.dispatchEvent(new Event('change',{bubbles:true}));}
      $('platformDialog').close();showToast(response.created?'Business platform added. Other online devices receive it on sync.':'This business platform already exists. It has been selected.','success');TIPONSync.kick();
    }catch(error){setText('platformStatus',error.message);}
    finally{busy=false;$('savePlatform').disabled=false;}
  }
  function bind(){
    document.querySelectorAll('[data-add-platform-for]').forEach(b=>b.addEventListener('click',()=>open(b.dataset.addPlatformFor)));
    attach('platformForm','submit',save);render();
  }
  return {bind,render,fill,load,accept,refresh,open,names};
})();
