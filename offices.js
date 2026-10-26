/* Office reference catalogue. Site geofences are configured separately. */
'use strict';
let editingOfficeId=null;
async function loadOfficeDirectory(){
 const saved=await getOne('meta','officeCatalogueV4');
 const all=new Map(TIPON_OFFICE_DATA.entries.map(o=>[o.id,{...o,origin:'Official-source reference'}]));
 for(const o of saved?.entries||[])all.set(o.id,o);
 state.offices=[...all.values()].sort((a,b)=>(a.coop||'ZZ').localeCompare(b.coop||'ZZ')||a.name.localeCompare(b.name));
}
async function persistOffices(){await saveOne('meta',{id:'officeCatalogueV4',entries:state.offices.filter(o=>o.userConfirmed)});}
function fillCoopSelect(id,allowAll=false){
 const el=$(id),old=el.value;el.innerHTML=(allowAll?'<option value="">All cooperatives</option>':'<option value="">Select cooperative</option>')+TIPON_OFFICE_DATA.cooperatives.map(c=>`<option>${esc(c)}</option>`).join('');
 if(TIPON_OFFICE_DATA.cooperatives.includes(old))el.value=old;
}
function fillSiteOffices(preferred){
 const coop=$('siteCoop').value,offices=state.offices.filter(o=>o.coop===coop);
 $('siteOffice').innerHTML='<option value="">'+(offices.length?'Select satellite / assigned office':'No confirmed office list yet - add an office')+'</option>'+offices.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}${o.type?.includes('Central')?' (central / formerly satellite)':''}</option>`).join('');
 if(offices.some(o=>o.id===preferred))$('siteOffice').value=preferred;
 setText('siteOfficeHint','Reference catalogue is incomplete. Add missing offices from an approved masterlist. Worksite GPS below is separate from the office address.');
}
function safeOfficeLink(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function renderOfficeDirectory(){
 fillCoopSelect('officeFilter',true);const coop=$('officeFilter').value;
 const rows=state.offices.filter(o=>!coop||o.coop===coop);
 setText('officeCount',`${rows.length} office references - masterlist not complete`);
 const missing=TIPON_OFFICE_DATA.cooperatives.filter(c=>!state.offices.some(o=>o.coop===c));
 $('officeRows').innerHTML=rows.map(o=>{const link=safeOfficeLink(o.source);return `<tr><td>${esc(o.coop||'Mapping not yet confirmed')}</td><td><b>${esc(o.name)}</b><small>${esc(o.type||'User-confirmed office')}</small></td><td>${esc(o.province||'')}</td><td><span class="badge ${o.userConfirmed?'green':'amber'}">${o.userConfirmed?'Confirmed by device user':'Reference - reconfirm'}</span><small>${esc(o.note||o.address||'')}</small>${link?`<a class="text-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Official / supplied source</a>`:`<small>${esc(o.source||'')}</small>`}</td><td><button class="tiny-button" data-office-edit="${esc(o.id)}">${o.userConfirmed?'Edit':'Confirm / edit'}</button></td></tr>`;}).join('')||'<tr><td colspan="5">No office entries supplied for this cooperative. Import the approved masterlist or add a confirmed office.</td></tr>';
 if(missing.length)$('officeRows').innerHTML+=`<tr><td colspan="5" class="directory-missing">Awaiting office masterlists: ${esc(missing.join(', '))}. No branches have been invented.</td></tr>`;
}
function openOfficeForm(id){
 const o=state.offices.find(x=>x.id===id);editingOfficeId=o?.id||null;$('officeForm').reset();fillCoopSelect('officeCoop');
 $('officeCoop').value=o?.coop||($('siteDialog').open?$('siteCoop').value:'');
 $('officeName').value=o?.name||'';$('officeProvince').value=o?.province||'';$('officeAddress').value=o?.address||'';$('officeSource').value=o?.source||'';
 $('officeDialog').showModal();
}
async function saveOfficeForm(e){
 e.preventDefault();const coop=$('officeCoop').value,name=$('officeName').value.trim();
 if(!TIPON_OFFICE_DATA.cooperatives.includes(coop)||!name||!$('officeApproved').checked)return;
 const same=state.offices.find(o=>o.id!==editingOfficeId&&o.coop===coop&&o.name.toLowerCase()===name.toLowerCase());
 if(same){showToast('This office already exists. Edit that entry instead.','error');return;}
 const office={id:editingOfficeId||uuid(),coop,name,province:$('officeProvince').value.trim(),address:$('officeAddress').value.trim(),source:$('officeSource').value.trim(),userConfirmed:true,type:'User-confirmed office',note:'Office confirmed by the device user against the supplied reference. Not independently verified by this app.',confirmedAt:new Date().toISOString()};
 const idx=state.offices.findIndex(o=>o.id===office.id);if(idx<0)state.offices.push(office);else state.offices[idx]=office;
 try{await persistOffices();renderOfficeDirectory();if($('siteDialog').open)fillSiteOffices(office.coop===$('siteCoop').value?office.id:null);$('officeDialog').close();showToast('Office saved on this phone. Existing worksite and attendance snapshots are unchanged.','success');}catch(err){toastError(err,'Save office');}
}
function parseOfficeCSV(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(ch===','&&!quoted){row.push(cell);cell='';}
  else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}
  else cell+=ch;
 }
 if(quoted)throw Error('CSV contains an unclosed quote.');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 return rows;
}
async function importOfficeCSV(e){
 const file=e.target.files?.[0];e.target.value='';if(!file)return;
 try{
  if(file.size>1024*1024)throw Error('Office CSV limit is 1 MB.');
  const rows=parseOfficeCSV((await file.text()).replace(/^\uFEFF/,''));
  const headings=['Cooperative','Satellite Office','Province','Address','Source / Approval Reference'];
  if(JSON.stringify(rows[0])!==JSON.stringify(headings))throw Error('Use the exact five headers from the CSV template.');
  if(rows.length<2||rows.length>1001)throw Error('Import between 1 and 1000 office rows.');
  const items=rows.slice(1).map((r,i)=>{
   const [coop,name,province,address,source]=r.map(x=>x.trim());
   if(r.length!==5||!TIPON_OFFICE_DATA.cooperatives.includes(coop)||!name||!source||r.some(x=>x.length>240))throw Error(`Invalid office CSV row ${i+2}. Check the cooperative, office, and approval reference.`);
   const same=state.offices.find(o=>o.coop===coop&&o.name.toLowerCase()===name.toLowerCase());
   return {id:same?.id||uuid(),coop,name,province,address,source,type:'User-confirmed office',userConfirmed:true,note:'Imported by the device user. Current status and authorization must be verified by the organization.',confirmedAt:new Date().toISOString()};
  });
  const keys=new Set();for(const o of items){const k=o.coop+'|'+o.name.toLowerCase();if(keys.has(k))throw Error('Duplicate office within CSV: '+o.name);keys.add(k);}
  const yes=await confirmAction('Import office masterlist?',`Import/update ${items.length} offices? Confirm that this is an authorized and current office masterlist. Existing worksite coordinates and historical logs will not be changed.`);if(!yes)return;
  const merged=new Map(state.offices.map(o=>[o.id,o]));items.forEach(o=>merged.set(o.id,o));state.offices=[...merged.values()];await persistOffices();renderOfficeDirectory();showToast(`${items.length} offices imported.`,'success');
 }catch(err){toastError(err,'Office import');}
}
function bindOfficeEvents(){
 attach('siteCoop','change',()=>fillSiteOffices());attach('officeFilter','change',renderOfficeDirectory);
 attach('addOffice','click',()=>openOfficeForm());attach('addOfficeFromSite','click',()=>openOfficeForm());attach('officeForm','submit',saveOfficeForm);
 attach('officeRows','click',e=>{const b=e.target.closest('[data-office-edit]');if(b)openOfficeForm(b.dataset.officeEdit);});
 attach('importOffices','click',()=>$('officeCsvFile').click());attach('officeCsvFile','change',importOfficeCSV);
 attach('officeCsvTemplate','click',()=>downloadBlob('TIPON_Office_Masterlist_Template.csv',new Blob(['\uFEFFCooperative,Business platform,Office,Address,Latitude,Longitude,Radius,Approval reference\r\n'],{type:'text/csv;charset=utf-8'})));
}
