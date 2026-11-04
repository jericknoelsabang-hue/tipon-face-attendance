/* TIPON KABILANG - Business Platform directory v5.5.19.
 * Codes are the existing authorization/attendance identifiers. Full names are
 * presentation metadata: changing a full name must never silently change a BP
 * code used by member, device or Work Location records.
 */
'use strict';
window.TIPONPlatforms=(()=>{
  const selectors=['sitePlatform','registerPlatform','migrationPlatform'];
  const PAGE_SIZE=10;
  const COOP_PLATFORMS=TIPONOrgCore.COOP_PLATFORMS||{};
  const STARTER_DIRECTORY=Object.freeze([
    {name:'Asiapro Construction',code:'AP Cons'},
    {name:'Asiapro Trucking System',code:'ATS'},
    {name:'Asiapro Contracting',code:'Contracting'},
    {name:'Gawa At Kalinga',code:'GAK'},
    {name:'Independent Manufacturing Group',code:'IMG'},
    {name:'Managed Services Group - North Mindanao',code:'MSG-NM'},
    {name:'Managed Services Group - Nationwide',code:'MSG-NW'},
    {name:'Managed Services Group - South Mindanao',code:'MSG-SM'},
    {name:'Other Construction Group',code:'OCG'}
  ]);
  const captions=new Map(STARTER_DIRECTORY.map(x=>[x.code.toLowerCase(),x.name]));
  const norm=s=>TIPONOrgCore.platformKey(String(s||''));
  const clean=s=>String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ').replace('Independent Manufactoring Group','Independent Manufacturing Group').replace('Managed Services Group - Nation Wide','Managed Services Group - Nationwide');
  let target='',busy=false,editingCode='',page=1,pendingByCode=new Map();
  function defaultNames(){return TIPONOrgCore.DEFAULT_PLATFORMS||[];}
  function names(){
    const referenced=rows=>(rows||[]).filter(x=>x&&!x.deleted).flatMap(x=>[x.platform,x.businessPlatform,x.bp]);
    return TIPONOrgCore.platformNames([
      ...defaultNames(),...STARTER_DIRECTORY.map(x=>x.code),...(state.platforms||[]),
      ...(state.platformRecords||[]).map(x=>x.code),
      ...referenced(state.members),...referenced(state.sites),...referenced(state.memberSiteOptions),
      ...referenced(state.accounts),...referenced(state.devices),...referenced(state.punches),
      state.user?.platform||''
    ]);
  }
  function detailsFrom(reply){
    for(const key of ['businessPlatformRecords','businessPlatformDetails','platformRecords']){
      if(Array.isArray(reply?.[key]))return reply[key];
    }
    return null;
  }
  function normalizeRecords(items,knownCodes=names()){
    if(!Array.isArray(items))return [];
    const known=new Set(knownCodes.map(norm)),seen=new Set(),result=[];
    for(const item of items){
      if(!item||typeof item!=='object')continue;
      const providedCode=clean(item.code||item.abbreviation||item.shortName||item.bpAbbreviation);
      const providedName=clean(item.name||item.bpName||item.platformName);
      const coop=clean(item.coop||item.cooperative||'');
      let code=clean(item.code||'');
      if(!code){
        // New backend: {name: full label, abbreviation: existing BP code}.
        // Older pilot: {name: existing BP code, abbreviation: optional label}.
        code=known.has(norm(providedCode))?providedCode:
          known.has(norm(providedName))?providedName:
          providedCode||providedName;
      }
      if(!code||seen.has(norm(code)))continue;
      seen.add(norm(code));
      let displayName=clean(item.displayName||item.fullName||item.label||'');
      if(!displayName&&norm(providedName)!==norm(code))displayName=providedName;
      if(!displayName)displayName=captions.get(norm(code))||code;
      result.push({code,name:displayName,coop});
    }
    return result;
  }
  function records(){
    const custom=new Map((state.platformRecords||[]).map(item=>[norm(item.code),item]));
    return names().map(code=>({
      code,
      name:clean(custom.get(norm(code))?.name)||captions.get(norm(code))||code,
      coop:clean(custom.get(norm(code))?.coop)||Object.keys(COOP_PLATFORMS).find(coop=>(COOP_PLATFORMS[coop]||[]).some(bp=>norm(bp)===norm(code)))||'',
      isDefault:defaultNames().some(name=>norm(name)===norm(code))
    }));
  }
  function fill(id,preferred){
    const el=$(id);if(!el)return;
    const value=preferred===undefined?el.value:clean(preferred);
    const scoped=state.user?.role==='registrar'&&id==='sitePlatform';
    const options=scoped?[state.user.platform]:TIPONOrgCore.platformNames([...names(),value]);
    const html='<option value="">Select business platform</option>'+
      options.filter(Boolean).map(name=>'<option value="'+esc(name)+'">'+esc(name)+'</option>').join('');
    if(el.innerHTML!==html)el.innerHTML=html;
    el.disabled=scoped;el.value=scoped?state.user.platform:value;
  }
  function hasReferences(code){
    const is=value=>norm(value)===norm(code);
    return [...(state.sites||[]).filter(x=>!x.deleted),
      ...(state.members||[]).filter(x=>!x.deleted),
      ...(state.accounts||[]).filter(x=>!x.deleted),
      ...(state.devices||[]).filter(x=>!x.deleted)]
      .some(x=>is(x.platform)||is(x.businessPlatform)||is(x.bp));
  }
  function renderDirectory(){
    if(!isAdmin()||!$('adminBPRows'))return;
    const q=norm($('adminBPSearch')?.value||'');
    const matches=records().filter(x=>!q||(norm(x.name)+' '+norm(x.code)).includes(q));
    const pages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));
    page=Math.min(Math.max(1,page),pages);
    const start=(page-1)*PAGE_SIZE,visible=matches.slice(start,start+PAGE_SIZE);
    $('adminBPRows').innerHTML=visible.length?visible.map(x=>{
      const pending=pendingByCode.get(norm(x.code));
      const status=pending?'<small class="bp-sync-status">'+(pending.errorCode==='NEEDS_REVIEW'?'Needs review':'Pending sync')+'</small>':'';
      return '<tr><td><b>'+esc(x.name)+'</b>'+status+'</td>'+
      '<td><span class="bp-abbreviation">'+esc(x.code)+'</span></td>'+
      '<td>'+esc(x.coop||'—')+'</td>'+
      '<td><div class="bp-row-actions">'+
      '<button type="button" class="tiny-button" data-bp-edit="'+esc(x.code)+'">Edit</button>'+
      '<button type="button" class="tiny-button delete" data-bp-delete="'+esc(x.code)+
        '" title="Deletion is checked against authorized member, account and Work Location records">Delete</button>'+
      '</div></td></tr>';
    }).join(''):'<tr><td colspan="4"><div class="empty-state">No matching Business Platforms.</div></td></tr>';
    setText('adminBPCount',matches.length+' business platform'+(matches.length===1?'':'s'));
    setText('adminBPPageCount',matches.length?
      'Showing '+(start+1)+'–'+(start+visible.length)+' of '+matches.length:'0 business platforms');
    setText('adminBPPage','Page '+page+' of '+pages);
    $('adminBPPrev').disabled=page===1;
    $('adminBPNext').disabled=page===pages;
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
    state.platformRecords=normalizeRecords(saved?.records);
    const queued=await getAll('outbox');
    pendingByCode=new Map(queued.filter(op=>op.orgId===state.orgId&&op.type==='platformChanges')
      .map(op=>[norm(op.value?.code),op]));
    render();
  }
  async function accept(values,rawDetails=null){
    state.platforms=TIPONOrgCore.platformNames(Array.isArray(values)?values:[]);
    const allowed=new Set(state.platforms.concat(defaultNames()).map(norm));
    if(Array.isArray(rawDetails))state.platformRecords=normalizeRecords(rawDetails);
    state.platformRecords=(state.platformRecords||[]).filter(x=>allowed.has(norm(x.code)));
    if(state.orgId&&state.user){
      await OrgDB.rawSave('meta',{id:'tp51-platforms:'+state.orgId,names:state.platforms,
        records:state.platformRecords,updatedAt:new Date().toISOString()});
    }
    render();
  }
  async function queueOfflineChange(value,nextNames,nextRecords){
    const existing=await getAll('outbox');
    if(existing.some(op=>op.orgId===state.orgId&&op.type==='platformChanges'&&norm(op.value?.code)===norm(value.code)))
      throw Error('This Business Platform already has a pending change. Sync it before editing it again.');
    const names=TIPONOrgCore.platformNames(nextNames);
    const normalized=normalizeRecords(nextRecords,names.concat(defaultNames()));
    const now=new Date().toISOString(),id=crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(36).slice(2);
    const op={id,type:'platformChanges',value:{...value},baseRev:0,orgId:state.orgId,ownerId:state.user.id,createdAt:now,everSent:false};
    const meta={id:'tp51-platforms:'+state.orgId,names,records:normalized,updatedAt:now};
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(['meta','outbox'],'readwrite');
      tx.objectStore('meta').put(meta);tx.objectStore('outbox').put(op);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
    state.platforms=names;state.platformRecords=normalized;
    pendingByCode.set(norm(value.code),op);render();return id;
  }
  function markSynced(code){pendingByCode.delete(norm(code));renderDirectory();}
  function setPendingStatus(code,errorCode,error){const op=pendingByCode.get(norm(code));if(op){op.errorCode=errorCode;op.error=error;}else pendingByCode.set(norm(code),{errorCode,error});renderDirectory();}
  async function refresh(){
    if(!navigator.onLine){render();return;}
    const response=await TIPONAPI.raw({action:'platforms'});
    if(state.user&&response.orgId!==state.orgId)
      throw Error('The organization destination changed. Reconnect with the system owner.');
    await accept(response.businessPlatforms||[],detailsFrom(response));
  }
  function open(id='',record=null){
    if(!isAdmin()){showToast('Only Administrators can manage Business Platforms.','info');return;}
    target=id||'';busy=false;editingCode=record?.code||'';
    $('platformForm').reset();
    $('newPlatformName').value=record?.name||'';
    $('newPlatformAbbreviation').value=record?.code||'';
    const coopSelect=$('newPlatformCooperative');
    if(coopSelect){coopSelect.innerHTML='<option value="">Select cooperative</option>'+TIPONOrgCore.COOPS.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');coopSelect.value=record?.coop||'';}
    const locked=!!record&&(record.isDefault||hasReferences(record.code));
    $('newPlatformAbbreviation').readOnly=locked;
    setText('platformFormTitle',record?'Edit Business Platform':'Add Business Platform');
    setText('platformFormNote',locked?
      'You may edit the full name. This platform code is locked because it is a default or has linked records; changing the code would affect existing access and attendance history.':
      'Changes must be confirmed by the central backend; existing records are never silently reassigned.');
    setText('platformStatus','');
    $('platformDialog').showModal();
    $('newPlatformName').focus();
  }
  function openEdit(code){
    const found=records().find(x=>norm(x.code)===norm(code));
    if(found)open('',found);
  }
  function explainBackend(error,action){
    const msg=String(error?.message||'');
    if(/unknown action|unsupported action|not implemented|invalid action|unrecognized|does not support/i.test(msg)||
       ['ACTION','UNKNOWN_ACTION','NOT_IMPLEMENTED'].includes(String(error?.code||''))){
      return 'The central Apps Script must be updated to support '+action+'. No change was saved.';
    }
    return msg||'The central database did not confirm the change.';
  }
  async function requireDirectoryBackend(){
    const info=await TIPONAPI.raw({action:'platforms'});
    if(state.user&&info.orgId!==state.orgId)
      throw Error('Organization changed. Sign out and reconnect to the approved organization.');
    if(!Array.isArray(detailsFrom(info)))
      throw Error('Business Platform editing is not yet available on the connected Apps Script. Install and deploy the BP Directory backend patch first. Nothing has been changed.');
    return info;
  }
  function verifyRecord(reply,name,code,deleted=false,coop=''){
    const list=reply?.businessPlatforms;
    const meta=detailsFrom(reply);
    if(!Array.isArray(list)||!Array.isArray(meta))
      throw Error('The central backend did not return an authoritative Business Platform directory.');
    const listed=list.some(x=>norm(x)===norm(code));
    if(deleted)return !listed;
    const saved=normalizeRecords(meta,list).find(x=>norm(x.code)===norm(code));
    // Legacy Apps Script may not yet store cooperative metadata; accept only when the requested value matches the approved local mapping.
    return listed&&saved&&norm(saved.name)===norm(name)&&norm(coop)===norm((COOP_PLATFORMS[coop]||[]).find(x=>norm(x)===norm(code))||'');
  }
  async function save(event){
    event.preventDefault();if(busy||!isAdmin())return;
    const name=clean($('newPlatformName').value),code=clean($('newPlatformAbbreviation').value),coop=clean($('newPlatformCooperative')?.value||'');
    if(!TIPONOrgCore.COOPS.includes(coop)){setText('platformStatus','Select a Cooperative.');return;}
    if(!(COOP_PLATFORMS[coop]||[]).some(x=>norm(x)===norm(code))){setText('platformStatus','This Business Platform is not assigned to the selected Cooperative in the approved mapping.');return;}
    if(name.length<2||name.length>80||code.length<2||code.length>20||
       /[<>\x00-\x1f\x7f]/.test(name+code)){
      setText('platformStatus','Enter a valid Business Platforms Name (2–80 characters) and Business Platform code (2–20 characters).');
      return;
    }
    const existing=records().find(x=>norm(x.code)===norm(editingCode));
    const others=records().filter(x=>norm(x.code)!==norm(editingCode));
    if(others.some(x=>norm(x.code)===norm(code)||norm(x.name)===norm(name))){
      setText('platformStatus','A Business Platform already uses that name or code.');return;
    }
    if(existing&&(existing.isDefault||hasReferences(editingCode))&&norm(code)!==norm(editingCode)){
      setText('platformStatus','This Business Platform code cannot be changed while it is a default or assigned to existing records.');return;
    }
    const editing=!!editingCode;
    if(!navigator.onLine){
      const nextNames=TIPONOrgCore.platformNames([...(state.platforms||[]).filter(item=>!editing||norm(item)!==norm(editingCode)),code]);
      const currentRecords=records().map(item=>({name:item.name,code:item.code,coop:item.coop}));
      let nextRecords;
      if(editing){
        let replaced=false;
        nextRecords=currentRecords.map(item=>{
          if(norm(item.code)!==norm(editingCode))return item;
          replaced=true;return {name,code,coop};
        });
        if(!replaced)nextRecords.push({name,code,coop});
      }else nextRecords=[...currentRecords,{name,code,coop}];
      try{
        await queueOfflineChange({action:editing?'update':'add',originalName:editingCode||'',name,code,abbreviation:code,coop},nextNames,nextRecords);
        $('platformDialog').close();
        showToast(editing?'Business Platform update saved locally. It will be verified when internet returns.':
          'Business Platform saved locally. It will be registered centrally when internet returns.','info',8000);
        TIPONSync.kick();
      }catch(error){setText('platformStatus',error.message);showToast(error.message,'error',8500);}
      return;
    }
    busy=true;$('savePlatform').disabled=true;
    setText('platformStatus','Verifying and saving with the central organization...');
    try{
      await requireDirectoryBackend();
      const response=await TIPONAPI.call(editing?
        {action:'platformUpdate',originalName:editingCode,name,abbreviation:code,coop}:
        {action:'platformAdd',name,abbreviation:code,coop});
      if(!verifyRecord(response,name,code,false,coop))
        throw Error('The backend did not confirm the exact Business Platform name and code. Please refresh before retrying.');
      await accept(response.businessPlatforms,detailsFrom(response));
      if(target){fill(target,code);$(target)?.dispatchEvent(new Event('change',{bubbles:true}));}
      $('platformDialog').close();
      showToast(editing?'Business Platform updated in the central directory.':
        'Business Platform added to the central directory.','success',6500);
      TIPONSync.kick();renderDirectory();
    }catch(error){setText('platformStatus',explainBackend(error,'Business Platform Add/Edit'));}
    finally{busy=false;$('savePlatform').disabled=false;}
  }
  async function deletePlatform(code){
    if(!isAdmin())return;
    const record=records().find(x=>norm(x.code)===norm(code));
    if(!record)return;
    if(record.isDefault){
      showToast('This is a default Business Platform. It cannot be deleted because other devices can still use its original code.','info',8500);
      return;
    }
    if(hasReferences(code)){
      showToast('This Business Platform is assigned to a member, account or Work Location. Reassign related records before deleting it.','info',8500);
      return;
    }
    const yes=await confirmAction('Delete Business Platform?',
      'Permanently remove "'+record.name+'" ('+record.code+') from the central directory? This is allowed only if the platform is unassigned.');
    if(!yes)return;
    if(!navigator.onLine){
      const nextNames=(state.platforms||[]).filter(item=>norm(item)!==norm(code));
      const nextRecords=records().filter(item=>norm(item.code)!==norm(code)).map(item=>({name:item.name,code:item.code}));
      try{
        await queueOfflineChange({action:'delete',originalName:code,name:record.name,code},nextNames,nextRecords);
        showToast('Business Platform deletion saved locally. It will be verified centrally when internet returns.','info',8500);
        TIPONSync.kick();renderDirectory();
      }catch(error){showToast(error.message,'error',8500);}
      return;
    }
    try{
      await requireDirectoryBackend();
      const response=await TIPONAPI.call({action:'platformDelete',name:code});
      if(!verifyRecord(response,'',code,true))
        throw Error('The central backend did not confirm deletion. The platform remains unchanged.');
      await accept(response.businessPlatforms,detailsFrom(response));
      showToast('Business Platform deletion confirmed by the central directory.','success',6500);
      TIPONSync.kick();renderDirectory();
    }catch(error){showToast(explainBackend(error,'Business Platform Delete'),'error',9000);}
  }
  function bind(){
    document.querySelectorAll('[data-add-platform-for]').forEach(b=>
      b.addEventListener('click',()=>open(b.dataset.addPlatformFor)));
    attach('platformForm','submit',save);
    attach('adminBPAdd','click',()=>open());
    attach('adminBPSearch','input',()=>{page=1;renderDirectory();});
    attach('adminBPPrev','click',()=>{if(page>1){page--;renderDirectory();}});
    attach('adminBPNext','click',()=>{page++;renderDirectory();});
    attach('adminBPRows','click',event=>{
      const edit=event.target.closest('[data-bp-edit]');
      const del=event.target.closest('[data-bp-delete]');
      if(edit){openEdit(edit.dataset.bpEdit);return;}
      if(del)void deletePlatform(del.dataset.bpDelete);
    });
    render();
  }
  return {bind,render,fill,load,accept,refresh,open,names,records,renderDirectory,hasReferences,verifyRecord,markSynced,setPendingStatus};
})();