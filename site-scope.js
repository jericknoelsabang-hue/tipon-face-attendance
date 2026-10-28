/* Admin multiple-Cooperative / Business-Platform work location scoping.
 * The central data model remains ONE coop and ONE platform per worksite.
 * This control explicitly creates one scoped site per selected pair.
 */
'use strict';
window.TIPONSiteScopes=(()=>{
 const $=id=>document.getElementById(id);
 const normalized=s=>String(s||'').trim().normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
 function values(id){return [...($(id)?.querySelectorAll('input[type="checkbox"]:checked')||[])].map(x=>x.value);}
 function setSummary(id,choices,placeholder){
  const xs=values(choices),el=$(id);
  if(el)el.textContent=xs.length?xs.length===1?xs[0]:xs.length+' selected':placeholder;
 }
 function refreshSelection(){
  const coops=values('siteCoopChoices'),platforms=values('sitePlatformChoices');
  if($('siteCoop'))$('siteCoop').value=coops[0]||'';
  if($('sitePlatform'))$('sitePlatform').value=platforms[0]||'';
  setSummary('siteCoopSummary','siteCoopChoices','Select cooperatives');
  setSummary('sitePlatformSummary','sitePlatformChoices','Select business platforms');
  const count=coops.length*platforms.length;
  const hint=$('siteScopeHint');
  if(hint)hint.textContent=count
   ?count+' authorized work location record'+(count===1?'':'s')+' will be created or updated (one per MPC / Business Platform pair). Maximum 12 combinations.'
   :'Select at least one Cooperative and one Business Platform. Each selected combination will have the same GPS and address.';
 }
 function checkboxes(id,options,current){
  const box=$(id);
  if(!box)return;
  const chosen=new Set(current.map(normalized));
  box.innerHTML=options.map(value=>{
   const checked=chosen.has(normalized(value))?' checked':'';
   return '<label class="site-scope-option"><input type="checkbox" value="'+esc(value)+'"'+checked+'/><span>'+esc(value)+'</span></label>';
  }).join('');
 }
 function reset(site,admin){
  document.querySelectorAll('[data-site-scope-single]').forEach(el=>el.hidden=!!admin);
  document.querySelectorAll('[data-site-scope-multi]').forEach(el=>el.hidden=!admin);
  // The original selectors remain for legacy security rules, but the admin
  // multi-picker validates itself so a hidden required selector cannot block submit.
  if($('siteCoop'))$('siteCoop').required=!admin;
  if($('sitePlatform'))$('sitePlatform').required=!admin;
  if(!admin)return;
  checkboxes('siteCoopChoices',TIPONOrgCore.COOPS,site?.coop?[site.coop]:[]);
  checkboxes('sitePlatformChoices',TIPONPlatforms.names(),site?.platform?[site.platform]:[]);
  for(const id of ['siteCoopMulti','sitePlatformMulti'])if($(id))$(id).open=false;
  refreshSelection();
 }
 function pairs(previous){
  if(!isAdmin())return [{coop:$('siteCoop').value,platform:$('sitePlatform').value}];
  const coops=values('siteCoopChoices'),platforms=values('sitePlatformChoices');
  if(!coops.length||!platforms.length)throw Error('Select at least one Cooperative and one Business Platform.');
  const count=coops.length*platforms.length;
  if(count>12)throw Error('Maximum 12 MPC / Business Platform combinations per Save. Reduce your selection.');
  const rows=coops.flatMap(coop=>platforms.map(platform=>({coop,platform})));
  if(previous&&!rows.some(row=>row.coop===previous.coop&&normalized(row.platform)===normalized(previous.platform))){
   throw Error('When editing an existing location, keep its original MPC and Business Platform selected. Add other combinations without replacing the existing location scope.');
  }
  return rows;
 }
 function bind(){
  for(const id of ['siteCoopChoices','sitePlatformChoices']){
   const box=$(id);if(box&&!box.dataset.scopeBound){box.dataset.scopeBound='1';box.addEventListener('change',refreshSelection);}
  }
  document.addEventListener('click',event=>{
   for(const id of ['siteCoopMulti','sitePlatformMulti']){
    const el=$(id);if(el?.open&&!el.contains(event.target))el.open=false;
   }
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
 return {reset,pairs,refreshSelection};
})();