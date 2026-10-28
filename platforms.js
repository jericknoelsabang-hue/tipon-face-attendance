/* TIPON KABILANG - Shared Business Platform directory.
 * The backend is the source of truth. Never pretend that a browser-local
 * abbreviation, rename or deletion was saved to the organization.
 * New backend endpoints: platformUpdate / platformDelete.
 */
'use strict';
window.TIPONPlatforms=(()=>{
  const selectors=['sitePlatform','registerPlatform','migrationPlatform'];
  const PAGE_SIZE=10;
  let target='',busy=false,editingName='',page=1;
  const norm=s=>TIPONOrgCore.platformKey(String(s||''));
  const clean=s=>String(s||'').trim().replace(/\s+/g,' ');
  function defaultNames(){return TIPONOrgCore.DEFAULT_PLATFORMS||[];}
  function names(){
    return TIPONOrgCore.platformNames([...defaultNames(),...(state.platforms||[]),
      ...(state.sites||[]).filter(s=>!s.deleted).map(s=>s.platform),state.user?.platform||'']);
  }
  function detailList(reply){
    if(Array.isArray(reply?.businessPlatformRecords))return reply.businessPlatformRecords;
    if(Array.isArray(reply?.businessPlatformDetails))return reply.businessPlatformDetails;
    if(Array.isArray(reply?.platformRecords))return reply.platformRecords;
    return null;
  }
  function cleanRecords(items){
    if(!Array.isArray(items))return [];
    const result=[],seen=new Set();
    for(const raw of items){
      if(!raw||typeof raw!=='object')continue;
      const name=clean(raw.name||raw.bpName||raw.platformName);
      const abbreviation=clean(raw.abbreviation||raw.abbrev||raw.shortName||raw.bpAbbreviation);
      if(!name||seen.has(norm(name)))continue;
      seen.add(norm(name));
      result.push({name,abbreviation});
    }
    return result;
  }
  function records(){
    const lookup=new Map((state.platformRecords||[]).map(p=>[norm(p.name),p]));
    return names().map(name=>({name,abbreviation:lookup.get(norm(name))?.abbreviation||'',
      isDefault:defaultNames().some(v=>norm(v)===norm(name))}));
  }
  function fill(id,preferred){
    const el=$(id);if(!el)return;
    const value=preferred===undefined?el.value:clean(preferred);
    const scoped=state.user?.role==='registrar'&&['sitePlatform','memberPlatform'].includes(id);
    const options=scoped?[state.user.platform]:TIPONOrgCore.platformNames([...names(),value]);
    const html='<option value="">Select business platform</option>'+options.filter(Boolean)
      .map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join('');
    if(el.innerHTML!==html)el.innerHTML=html;
    el.disabled=scoped;el.value=scoped?state.user.platform:value;
  }
  function renderDirectory(){
    if(!isAdmin()||!$('adminBPRows'))return;
    const query=norm($('adminBPSearch')?.value||'');
    const rows=records().filter(p=>!query||(norm(p.name)+' '+norm(p.abbreviation)).includes(query));
    const total=rows.length,pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
    page=Math.min(Math.max(1,page),pages);
    const start=(page-1)*PAGE_SIZE,visible=rows.slice(start,start+PAGE_SIZE);
    $('adminBPRows').innerHTML=visible.length?visible.map(p=>{
      const used=hasReferences(p.name);
      const note=p.isDefault?'<small class="bp-default-note">Default organization platform</small>':'';
      const abbr=p.abbreviation?'<span class="bp-abbreviation">'+esc(p.abbreviation)+'</span>':'<span class="bp-unknown">Not set</span>';
      return '<tr><td><b>'+esc(p.name)+'</b>'+note+'</td><td>'+abbr+'</td>'+
        '<td><div class="bp-row-actions">'+
          '<button type="button" class="tiny-button" data-bp-edit="'+esc(p.name)+'">Edit</button>'+
          '<button type="button" class="tiny-button delete" data-bp-delete="'+esc(p.name)+'"'+
          (used||p.isDefault?' disabled title="Reassign linked records before deleting this platform"':'')+'>Delete</button>'+
        '</div></td></tr>';
    }).join(''):'<tr><td colspan="3"><div class="empty-state">No matching Business Platforms.</div></td></tr>';
    setText('adminBPCount',total+' business platform'+(total===1?'':'s'));
    setText('adminBPPageCount',total?'Showing '+(start+1)+'–'+(start+visible.length)+' of '+total:'0 business platforms');
    setText('adminBPPage','Page '+page+' of '+pages);
    $('adminBPPrev').disabled=page<=1;
    $('adminBPNext').disabled=page>=pages;
  }
  function render(){
    selectors.forEach(id=>fill(id));
    if($('platformChips'))$('platformChips').innerHTML=names().map(n=>'<span class="platform-chip">'+esc(n)+'</span>').join('');
    document.querySelectorAll('[data-add-platform-for]').forEach(b=>b.hidden=!isAdmin());
    renderDirectory();
  }
  async function load(){
    const saved=await getOne('meta','tp51-platforms:'+state.orgId);
    state.platforms=TIPONOrgCore.platformNames(saved?.names||[]);
    state.platformRecords=cleanRecords(saved?.records);
    render();
  }
  async function accept(values,details=null){
    state.platforms=TIPONOrgCore.platformNames(Array.isArray(values)?values:[]);
    if(Array.isArray(details))state.platformRecords=cleanRecords(details);
    const source=new Set(state.platforms.map(norm));
    // Retain only server-provided records for names still in the central list.
    state.platformRecords=(state.platformRecords||[]).filter(item=>source.has(norm(item.name)));
    if(state.orgId&&state.user)await OrgDB.rawSave('meta',{
      id:'tp51-platforms:'+state.orgId,names:state.platforms,records:state.platformRecords,
      updatedAt:new Date().toISOString()
    });
    render();
  }
  async function refresh(){
    if(!navigator.onLine){render();return;}
    const response=await TIPONAPI.raw({action:'platforms'});
    if(state.user&&response.orgId!==state.orgId)throw Error('The organization destination changed. Reconnect with the system owner.');
    await accept(response.businessPlatforms||[],detailList(response));
  }
  function hasReferences(name){
    const is=v=>norm(v)===norm(name);
    return [...(state.sites||[]).filter(x=>!x.deleted),
      ...(state.members||[]).filter(x=>!x.deleted),
      ...(state.accounts||[]),...(state.devices||[])]
      .some(x=>is(x.platform)||is(x.businessPlatform)||is(x.bp));
  }
  function open(id='',record=null){
    if(!isAdmin()){showToast('Only the Administrator can manage Business Platforms.','info');return;}
    target=id||'';busy=false;editingName=record?.name||'';
    $('platformForm').reset();
    $('newPlatformName').value=record?.name||'';
    $('newPlatformAbbreviation').value=record?.abbreviation||'';
    setText('platformFormTitle',record?'Edit Business Platform':'Add Business Platform');
    setText('platformFormNote',record&&hasReferences(record.name)
      ?'This BP is assigned to existing records. Its name cannot be changed until affected records are reassigned. You can request an abbreviation update.'
      :'Changes require central Apps Script confirmation; no local-only edits will be shown as saved.');
    $('newPlatformName').readOnly=!!record&&hasReferences(record.name);
    setText('platformStatus','');
    $('platformDialog').showModal();
    (record?$('newPlatformAbbreviation'):$('newPlatformName')).focus();
  }
  function openEdit(name){
    const record=records().find(r=>norm(r.name)===norm(name));
    if(!record)return;
    open('',record);
  }
  function backendMissing(error,action){
    const message=String(error?.message||'');
    if(error?.code==='ACTION'||/unknown action|unsupported action|not implemented|invalid action/i.test(message)){
      return 'The central Apps Script deployment does not yet support '+action+
        '. No change was saved. Add the matching platform management endpoint on the backend first.';
    }
    return message||'The server did not confirm the Business Platform change.';
  }
  async function save(event){
    event.preventDefault();
    if(busy||!isAdmin())return;
    const name=clean($('newPlatformName').value),abbreviation=clean($('newPlatformAbbreviation').value);
    if(name.length<2||name.length>80||abbreviation.length<2||abbreviation.length>20){
      setText('platformStatus','Enter a BP Name (2–80 characters) and an Abbreviation (2–20 characters).');return;
    }
    const collisions=records();
    if(collisions.some(r=>norm(r.name)===norm(name)&&norm(r.name)!==norm(editingName))){
      setText('platformStatus','A Business Platform with this name already exists. Choose Edit on its row.');return;
    }
    if(editingName&&norm(name)!==norm(editingName)&&hasReferences(editingName)){
      setText('platformStatus','Reassign existing sites, members and accounts before renaming this Business Platform.');return;
    }
    if(!navigator.onLine){setText('platformStatus','Connect to the internet to save Business Platform changes centrally.');return;}
    busy=true;$('savePlatform').disabled=true;
    setText('platformStatus',editingName?'Submitting BP update...':'Submitting new BP...');
    try{
      const mode=!!editingName;
      const response=await TIPONAPI.call(mode?
        {action:'platformUpdate',originalName:editingName,name,abbreviation}:
        {action:'platformAdd',name,abbreviation});
      const labels=Array.isArray(response.businessPlatforms)?response.businessPlatforms:null;
      if(!labels||!labels.some(p=>norm(p)===norm(name)))
        throw Error('The central server did not acknowledge the BP Name. Nothing has been marked saved.');
      const details=detailList(response);
      // Do not invent a stored abbreviation when the old server only accepts names.
      await accept(labels,details);
      if(target){fill(target,name);$(target)?.dispatchEvent(new Event('change',{bubbles:true}));}
      $('platformDialog').close();
      const confirmed=records().find(r=>norm(r.name)===norm(name));
      if(confirmed?.abbreviation&&norm(confirmed.abbreviation)===norm(abbreviation)){
        showToast((mode?'Business Platform updated':'Business Platform added')+' with the confirmed abbreviation.','success',6500);
      }else{
        showToast('BP Name was accepted, but the abbreviation was not confirmed by the backend. Update Apps Script support before relying on it.','info',10000);
      }
      TIPONSync.kick();renderDirectory();
    }catch(error){setText('platformStatus',backendMissing(error,editingName?'Business Platform editing':'BP Name/Abbreviation registration'));}
    finally{busy=false;$('savePlatform').disabled=false;}
  }
  async function deletePlatform(name){
    if(!isAdmin())return;
    const record=records().find(p=>norm(p.name)===norm(name));
    if(!record)return;
    if(record.isDefault||hasReferences(name)){
      showToast('This BP is a default or is assigned to members, accounts, or Work Locations. Reassign its dependencies before deleting.','error',8000);
      return;
    }
    const approved=await confirmAction('Delete Business Platform','Delete "'+record.name+'"? Only unassigned Business Platforms can be removed.');
    if(!approved)return;
    if(!navigator.onLine){showToast('Internet is required to delete a Business Platform.','error');return;}
    try{
      const response=await TIPONAPI.call({action:'platformDelete',name:record.name});
      const updated=response.businessPlatforms;
      if(!Array.isArray(updated)||updated.some(x=>norm(x)===norm(name)))
        throw Error('The backend did not confirm this Business Platform was removed.');
      await accept(updated,detailList(response));showToast('Business Platform deletion confirmed by central database.','success');
      renderDirectory();TIPONSync.kick();
    }catch(error){showToast(backendMissing(error,'Business Platform deletion'),'error',9000);}
  }
  function bind(){
    document.querySelectorAll('[data-add-platform-for]').forEach(b=>b.addEventListener('click',()=>open(b.dataset.addPlatformFor)));
    attach('platformForm','submit',save);
    attach('adminBPAdd','click',()=>open());
    attach('adminBPSearch','input',()=>{page=1;renderDirectory();});
    attach('adminBPPrev','click',()=>{if(page>1){page--;renderDirectory();}});
    attach('adminBPNext','click',()=>{page++;renderDirectory();});
    attach('adminBPRows','click',e=>{
      const edit=e.target.closest('[data-bp-edit]'),del=e.target.closest('[data-bp-delete]');
      if(edit){openEdit(edit.dataset.bpEdit);return;}
      if(del&&!del.disabled)void deletePlatform(del.dataset.bpDelete);
    });
    render();
  }
  return {bind,render,fill,load,accept,refresh,open,names,records,renderDirectory,hasReferences};
})();