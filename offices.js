/* Read-only office reference directory. Attendance geofences are configured as worksites. */
'use strict';
async function loadOfficeDirectory(){
 const saved=await getOne('meta','officeCatalogueV4');
 const all=new Map(TIPON_OFFICE_DATA.entries.map(o=>[o.id,{...o,origin:'Official-source reference'}]));
 for(const o of saved?.entries||[])all.set(o.id,o);
 state.offices=[...all.values()].sort((a,b)=>(a.coop||'ZZ').localeCompare(b.coop||'ZZ')||a.name.localeCompare(b.name));
}
function fillCoopSelect(id,allowAll=false){
 const el=$(id),old=el.value;el.innerHTML=(allowAll?'<option value="">All cooperatives</option>':'<option value="">Select cooperative</option>')+TIPON_OFFICE_DATA.cooperatives.map(c=>`<option>${esc(c)}</option>`).join('');
 if(TIPON_OFFICE_DATA.cooperatives.includes(old))el.value=old;
}
function fillSiteOffices(preferred){
 const coop=$('siteCoop').value,offices=state.offices.filter(o=>o.coop===coop);
 $('siteOffice').innerHTML='<option value="">'+(offices.length?'Select satellite office':'No approved office listed. Import the approved masterlist from Work locations.')+'</option>'+offices.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
 if(offices.some(o=>o.id===preferred))$('siteOffice').value=preferred;
 setText('siteOfficeHint','Choose an approved office from the masterlist. GPS coordinates are captured separately for each work location.');
}
function safeOfficeLink(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function renderOfficeDirectory(){
 fillCoopSelect('officeFilter',true);const coop=$('officeFilter').value,rows=state.offices.filter(o=>!coop||o.coop===coop);
 setText('officeCount',`${rows.length} office references`);
 const missing=TIPON_OFFICE_DATA.cooperatives.filter(c=>!state.offices.some(o=>o.coop===c));
 $('officeRows').innerHTML=rows.map(o=>{const link=safeOfficeLink(o.source);return `<tr><td>${esc(o.coop||'Mapping not yet confirmed')}</td><td><b>${esc(o.name)}</b><small>${esc(o.type||'Approved office reference')}</small></td><td>${esc(o.province||'')}</td><td><span class="badge ${o.userConfirmed?'green':'amber'}">${o.userConfirmed?'Imported / confirmed':'Reference - reconfirm'}</span><small>${esc(o.note||o.address||'')}</small>${link?`<a class="text-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Official / supplied source</a>`:`<small>${esc(o.source||'')}</small>`}</td></tr>`;}).join('')||'<tr><td colspan="4">No office entries supplied. Import the approved masterlist from Work locations.</td></tr>';
 if(missing.length)$('officeRows').innerHTML+=`<tr><td colspan="4" class="directory-missing">Awaiting office masterlists: ${esc(missing.join(', '))}.</td></tr>`;
}
function bindOfficeEvents(){
 attach('siteCoop','change',()=>fillSiteOffices());attach('officeFilter','change',renderOfficeDirectory);
}
