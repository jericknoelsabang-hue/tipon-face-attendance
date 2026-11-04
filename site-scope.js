/* Admin Cooperative / Business Platform work location scoping. */
'use strict';
window.TIPONSiteScopes=(()=>{
 const $=id=>document.getElementById(id);
 const norm=s=>String(s||'').trim().normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
 const mapping=window.TIPONCoopPlatforms||{};
 function platformsFor(coop){return mapping[coop]||[];}
 function renderPlatforms(preferred=''){
  const sel=$('sitePlatform');if(!sel)return;
  const coop=$('siteCoop')?.value||'';const options=platformsFor(coop);
  const keep=options.find(x=>norm(x)===norm(preferred||sel.value))||'';
  sel.innerHTML='<option value="">Select business platform</option>'+options.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');
  sel.value=keep;sel.disabled=!coop;
 }
 function reset(site,admin){
  const coop=$('siteCoop'),platform=$('sitePlatform');
  document.querySelectorAll('[data-site-scope-single]').forEach(el=>el.hidden=false);
  document.querySelectorAll('[data-site-scope-multi]').forEach(el=>el.hidden=true);
  if(coop){coop.required=true;coop.disabled=!admin;coop.innerHTML='<option value="">Select cooperative</option>'+TIPONOrgCore.COOPS.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');coop.value=site?.coop||(state.user?.coop||'Asiapro');}
  renderPlatforms(site?.platform||''); if(platform){platform.required=true;platform.disabled=!admin||!coop?.value;}
  const hint=$('siteScopeHint');if(hint){hint.hidden=false;hint.textContent='Business Platforms are limited to the selected Cooperative.';}
  document.querySelectorAll('[data-site-scope-single]').forEach(el=>{el.hidden=!admin;});
 }
 function pairs(previous){
  const coop=$('siteCoop')?.value||'',platform=$('sitePlatform')?.value||'';
  if(!coop||!platform)throw Error('Select a Cooperative and its Business Platform.');
  if(!platformsFor(coop).some(x=>norm(x)===norm(platform)))throw Error('This Business Platform is not assigned to the selected Cooperative.');
  if(previous&&(previous.coop!==coop||norm(previous.platform)!==norm(platform)))throw Error('Editing a Work Location cannot change its Cooperative or Business Platform.');
  return [{coop,platform}];
 }
 function bind(){
  const coop=$('siteCoop');if(coop&&!coop.dataset.coopBound){coop.dataset.coopBound='1';coop.addEventListener('change',()=>renderPlatforms(''));}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
 return {reset,pairs,refreshSelection:()=>renderPlatforms()};
})();