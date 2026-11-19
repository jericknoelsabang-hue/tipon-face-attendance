/* TIPON 5.5.113 — Paygroup directory, assignment pickers and Time In operation selection. */
'use strict';
window.TIPONPaygroups = (() => {
  const $ = id => document.getElementById(id);
  const norm = value => TIPONOrgCore.platformKey(value || '');
  const ids = value => [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))];
  const all = () => Array.isArray(state.paygroups) ? state.paygroups.filter(x => !x.deleted) : [];
  const byId = id => all().find(x => String(x.id) === String(id)) || null;
  const codes = pg => Array.isArray(pg?.operationCodes) ? pg.operationCodes.map(x => String(x || '').trim()).filter(Boolean) : [];
  const sameIds = (a,b) => ids(a).sort().join('|') === ids(b).sort().join('|');
  const canCreatePaygroup = () => isAdmin() || state.user?.role === 'registrar';
  let editing = null;
  let dialogCodes = [];
  let pendingSelection = null;

  function groupsForScope(coop, platform) {
    if (!coop || !platform) return [];
    return all().filter(pg => pg.coop === coop && norm(pg.platform) === norm(platform))
      .sort((a,b) => String(a.name || '').localeCompare(String(b.name || '')));
  }
  function groupsForSite(site) {
    return ids(site?.paygroupIds).map(byId).filter(Boolean);
  }
  function groupsForMember(member) {
    return ids(member?.paygroupIds).map(byId).filter(Boolean);
  }
  function namesForSite(site) {
    return groupsForSite(site).map(pg => pg.name).join(', ') || '—';
  }
  function namesForMember(member) {
    return groupsForMember(member).map(pg => pg.name).join(', ') || '—';
  }
  function locationsForPaygroup(pg) {
    return (state.sites || []).filter(site => !site.deleted && ids(site.paygroupIds).includes(String(pg.id)))
      .map(site => site.name).filter(Boolean).join(', ') || 'Not assigned';
  }
  function forMemberAtSite(member, site) {
    const assigned = ids(member?.paygroupIds);
    const onSite = new Set(ids(site?.paygroupIds));
    return assigned.map(byId).filter(pg => pg && onSite.has(String(pg.id)) &&
      pg.coop === member.coop && norm(pg.platform) === norm(site?.platform));
  }

  function updatePickerSummary(choicesId, summaryId) {
    const root = $(choicesId), summary = $(summaryId);
    if (!root || !summary) return;
    const count = root.querySelectorAll('[data-paygroup-option]:checked').length;
    summary.textContent = count ? count + ' Paygroup' + (count === 1 ? '' : 's') + ' selected' : 'Select Paygroup';
  }
  function fillPicker(choicesId, summaryId, items, selectedIds, emptyMessage, unavailableIds = []) {
    const root = $(choicesId);
    if (!root) return;
    const selected = new Set(ids(selectedIds)), unavailable = new Set(ids(unavailableIds));
    root.innerHTML = items.length ? items.map(pg => {
      const opCount = codes(pg).length, isUnavailable = unavailable.has(String(pg.id));
      return '<label class="multi-select-option' + (isUnavailable ? ' paygroup-unavailable-option' : '') + '"><input type="checkbox" data-paygroup-option="' + esc(pg.id) + '"' +
        (selected.has(String(pg.id)) ? ' checked' : '') + '/><span>' + esc(pg.name) +
        '<small>' + esc(pg.coop) + ' · ' + esc(pg.platform) + ' · ' +
        (isUnavailable ? 'Not assigned to selected Work Location' : opCount ? opCount + ' operation code' + (opCount === 1 ? '' : 's') : 'No operation code') +
        '</small></span></label>';
    }).join('') : '<p class="mini-info">' + esc(emptyMessage || 'No matching Paygroups are available.') + '</p>';
    updatePickerSummary(choicesId, summaryId);
  }
  function readPicker(choicesId) {
    const root = $(choicesId);
    return root ? [...root.querySelectorAll('[data-paygroup-option]:checked')].map(el => String(el.dataset.paygroupOption)) : [];
  }
  function fillSitePicker(selectedIds = readPicker('sitePaygroupChoices')) {
    const coop = $('siteCoop')?.value || state.user?.coop || '';
    const platform = $('sitePlatform')?.value || state.user?.platform || '';
    fillPicker('sitePaygroupChoices', 'sitePaygroupSummary', groupsForScope(coop, platform), selectedIds,
      'No Paygroups are available for this Cooperative / Business Platform.');
  }
  function selectedMemberSites(variant) {
    if (variant === 'admin') {
      return [...document.querySelectorAll('#adminMemberSiteChoices input[data-admin-member-site]:checked')].map(el => String(el.dataset.adminMemberSite));
    }
    return [...($('memberSite')?.selectedOptions || [])].map(option => String(option.value));
  }
  function fillMemberPicker(variant = 'user', selectedIds = []) {
    const admin = variant === 'admin';
    const coop = $(admin ? 'adminMemberCoop' : 'memberCoop')?.value || '';
    const platform = $(admin ? 'adminMemberPlatform' : 'memberPlatform')?.value || '';
    const sites = selectedMemberSites(variant).map(id => state.sites.find(site => site.id === id && !site.deleted)).filter(Boolean);
    const scoped = groupsForScope(coop, platform);
    const available = sites.length ? scoped.filter(pg => sites.some(site => ids(site.paygroupIds).includes(String(pg.id)))) : scoped;
    const availableIds = new Set(available.map(pg => String(pg.id)));
    const unavailableSelected = ids(selectedIds).map(byId).filter(pg => pg && !availableIds.has(String(pg.id)));
    const displayItems = [...available, ...unavailableSelected.filter(pg => !availableIds.has(String(pg.id)))];
    fillPicker(admin ? 'adminMemberPaygroupChoices' : 'memberPaygroupChoices',
      admin ? 'adminMemberPaygroupSummary' : 'memberPaygroupSummary', displayItems, selectedIds,
      'Assign Paygroups to the selected Work Location(s) first.', unavailableSelected.map(pg => pg.id));
  }
  function refreshMemberPicker(variant = 'user') {
    const id = variant === 'admin' ? 'adminMemberPaygroupChoices' : 'memberPaygroupChoices';
    fillMemberPicker(variant, readPicker(id));
  }
  function validateSiteAssignment(coop, platform, selectedIds) {
    const selected = ids(selectedIds);
    const available = new Set(groupsForScope(coop, platform).map(pg => String(pg.id)));
    if (selected.some(id => !available.has(id))) throw Error('Choose only Paygroups matching the Work Location Cooperative and Business Platform.');
    return selected;
  }
  function validateMemberAssignment(coop, platform, siteIds, selectedIds) {
    const selected = ids(selectedIds);
    const sites = ids(siteIds).map(id => state.sites.find(site => site.id === id && !site.deleted)).filter(Boolean);
    const available = new Set(groupsForScope(coop, platform)
      .filter(pg => sites.some(site => ids(site.paygroupIds).includes(String(pg.id))))
      .map(pg => String(pg.id)));
    if (selected.some(id => !available.has(id))) throw Error('Choose only Paygroups assigned to at least one of the member\'s selected Work Locations.');
    return selected;
  }

  function openOperationCodeView(id) {
    const pg = byId(id);
    const operationCodes = codes(pg);
    if (!pg || !operationCodes.length) return;
    setText('paygroupCodesViewTitle', 'Operation Codes — ' + (pg.name || 'Paygroup'));
    const root = $('paygroupCodesViewList');
    if (root) root.innerHTML = operationCodes.map((code,index) =>
      '<li class="paygroup-code-view-item"><span>' + (index + 1) + '</span><b>' + esc(code) + '</b></li>'
    ).join('');
    $('paygroupCodesViewDialog')?.showModal();
  }

  function openAssignedPaygroupsView(title, paygroupIds) {
    const selected=ids(paygroupIds).map(byId).filter(Boolean);
    if(!selected.length)return;
    setText('paygroupCodesViewTitle',title||'Assigned Paygroups');
    const root=$('paygroupCodesViewList');if(root)root.innerHTML=selected.map((pg,index)=>'<li class="paygroup-code-view-item"><span>'+(index+1)+'</span><b>'+esc(pg.name||'Paygroup')+'</b>'+(codes(pg).length?' <small>Operation codes: '+esc(codes(pg).join(', '))+'</small>':'')+'</li>').join('');
    $('paygroupCodesViewDialog')?.showModal();
  }

  let directoryPage=1;const DIRECTORY_PAGE_SIZE=6;
  function renderDirectory() {
    const groups = all().slice().sort((a,b) =>
      String(a.coop || '').localeCompare(String(b.coop || '')) ||
      String(a.platform || '').localeCompare(String(b.platform || '')) ||
      String(a.name || '').localeCompare(String(b.name || '')));
    const total=groups.length,pages=Math.max(1,Math.ceil(total/DIRECTORY_PAGE_SIZE));directoryPage=Math.max(1,Math.min(directoryPage,pages));const start=(directoryPage-1)*DIRECTORY_PAGE_SIZE;const visible=groups.slice(start,start+DIRECTORY_PAGE_SIZE);
    const admin = isAdmin();
    if ($('adminPaygroupPanel')) $('adminPaygroupPanel').hidden = !admin;
    if ($('userPaygroupPanel')) $('userPaygroupPanel').hidden = admin;
    if ($('userPaygroupAdd')) $('userPaygroupAdd').hidden = !canCreatePaygroup();
    const renderRows = (items, withActions) => items.length ? items.map(pg => {
      const operationCodes = codes(pg);
      const action = '<td><div class="row-inline">'+(withActions ? '<button type="button" class="tiny-button" data-paygroup-edit="' + esc(pg.id) + '">Edit</button><button type="button" class="tiny-button delete" data-paygroup-delete="' + esc(pg.id) + '">Delete</button>' : state.user?.role === 'registrar' ? '<button type="button" class="tiny-button" data-paygroup-edit="' + esc(pg.id) + '">Edit</button>' : '—')+'</div></td>';
      const operationCodeView = operationCodes.length
        ? '<button type="button" class="tiny-button" data-paygroup-view-codes="' + esc(pg.id) + '">View</button>'
        : '—';
      return '<tr><td>' + esc(pg.coop || '—') + '</td><td>' + esc(pg.platform || '—') + '</td><td>' +
        esc(locationsForPaygroup(pg)) + '</td><td><b>' + esc(pg.name || '—') + '</b></td><td>' +
        operationCodeView + '</td>' + action + '</tr>';
    }).join('') : '<tr><td colspan="' + '6' + '"><div class="empty-state">' +
      (!state.paygroupBackendReady ? 'Paygroup backend update is required. Install backend-patch/README_PAYGROUP.md and redeploy the existing Apps Script Web App.' :
        'No Paygroups have been configured for this account scope.') + '</div></td></tr>';
    if ($('adminPaygroupRows')) {
      $('adminPaygroupRows').innerHTML = renderRows(visible, true);
      setText('adminPaygroupCount', groups.length + ' paygroup' + (groups.length === 1 ? '' : 's'));
    }
    if ($('userPaygroupRows')) {
      $('userPaygroupRows').innerHTML = renderRows(visible, false);
      setText('userPaygroupCount', groups.length + ' paygroup' + (groups.length === 1 ? '' : 's'));
    }
    ['admin','user'].forEach(prefix=>{const count=$(`${prefix}PaygroupCount`);if(count)count.textContent='Showing '+(total?start+1:0)+'–'+Math.min(start+DIRECTORY_PAGE_SIZE,total)+' of '+total+' paygroups';const page=$(`${prefix}PaygroupPage`);if(page)page.textContent='Page '+directoryPage+' of '+pages;const prev=$(`${prefix}PaygroupPrev`),next=$(`${prefix}PaygroupNext`);if(prev)prev.disabled=directoryPage<=1;if(next)next.disabled=directoryPage>=pages;});
    if ($('paygroupBackendStatus')) {
      $('paygroupBackendStatus').textContent = state.paygroupBackendReady
        ? 'Central Paygroup directory connected.'
        : 'Central Paygroup endpoints are not yet confirmed. Install the Apps Script backend patch before using this module.';
    }
  }

  function fillPaygroupScope(pg) {
    const coop = $('paygroupCoop');
    if (!coop) return;
    const registrar = state.user?.role === 'registrar' && !isAdmin();
    const allowedCoops = registrar ? [state.user.coop].filter(value => TIPONOrgCore.COOPS.includes(value)) : TIPONOrgCore.COOPS;
    coop.innerHTML = '<option value="">Select cooperative</option>' +
      allowedCoops.map(value => '<option value="' + esc(value) + '">' + esc(value) + '</option>').join('');
    coop.value = registrar ? state.user.coop : pg?.coop || '';
    TIPONPlatforms.fillScoped('paygroupCoop', 'paygroupPlatform', registrar ? state.user.platform : pg?.platform || '');
    const referenced = !!(pg && ((pg.siteIds || []).length ||
      (state.sites || []).some(site => ids(site.paygroupIds).includes(String(pg.id))) ||
      (state.members || []).some(member => ids(member.paygroupIds).includes(String(pg.id)))));
    $('paygroupCoop').disabled = registrar || referenced;
    $('paygroupPlatform').disabled = registrar || referenced;
  }
  function renderOperationCodeChips() {
    const root = $('paygroupOperationCodes');
    if (!root) return;
    root.innerHTML = dialogCodes.length ? dialogCodes.map((code,index) =>
      '<span class="paygroup-code-chip"><b>' + esc(code) + '</b><button type="button" data-remove-operation-code="' +
      index + '" aria-label="Remove ' + esc(code) + '">×</button></span>').join('') :
      '<span class="mini-info">No operation codes added.</span>';
  }
  function toggleOperationCodeFields() {
    const enabled = $('paygroupHasOperationCodes')?.value === 'yes';
    if ($('paygroupOperationCodeSection')) $('paygroupOperationCodeSection').hidden = !enabled;
  }
  function openDialog(pg = null) {
    if (!canCreatePaygroup() || (pg && !isAdmin() && state.user?.role !== 'registrar')) return;
    if(pg&&state.user?.role==='registrar'&&(pg.coop!==state.user.coop||norm(pg.platform)!==norm(state.user.platform)))return;
    editing = pg ? { ...pg } : null;
    dialogCodes = codes(pg);
    $('paygroupForm')?.reset();
    fillPaygroupScope(pg);
    $('paygroupName').value = pg?.name || '';
    $('paygroupHasOperationCodes').value = dialogCodes.length ? 'yes' : 'no';
    toggleOperationCodeFields();
    renderOperationCodeChips();
    setText('paygroupFormTitle', pg ? 'Edit Paygroup' : 'Add Paygroup');
    setText('paygroupStatus', '');
    $('paygroupDialog')?.showModal();
  }
  function addOperationCode() {
    if (!canCreatePaygroup() || (editing && !isAdmin() && state.user?.role !== 'registrar')) return;
    const input = $('paygroupOperationCodeInput');
    const value = String(input?.value || '').trim().normalize('NFKC').replace(/\s+/g, ' ');
    if (!value) return;
    if (value.length > 60) return setText('paygroupStatus', 'Operation Code must be 60 characters or fewer.');
    if (dialogCodes.some(code => code.toLowerCase() === value.toLowerCase()))
      return setText('paygroupStatus', 'This Operation Code is already listed.');
    if (dialogCodes.length >= 30) return setText('paygroupStatus', 'Maximum 30 Operation Codes per Paygroup.');
    dialogCodes.push(value);
    if (input) input.value = '';
    setText('paygroupStatus', '');
    renderOperationCodeChips();
    input?.focus();
  }
  async function savePaygroup(event) {
    event.preventDefault();
    if (!canCreatePaygroup() || (editing && !isAdmin())) return;
    const button = $('paygroupSave');
    if (button) button.disabled = true;
    try {
      if (!navigator.onLine) throw Error('Internet is required to save a Paygroup to the central directory.');
      const coop = $('paygroupCoop').value;
      const platform = $('paygroupPlatform').value;
      if (!isAdmin() && (coop !== state.user?.coop || norm(platform) !== norm(state.user?.platform)))
        throw Error('You may add or edit Paygroups only within your approved Cooperative and Business Platform.');
      const name = String($('paygroupName').value || '').trim().normalize('NFKC').replace(/\s+/g, ' ');
      const hasCodes = $('paygroupHasOperationCodes').value === 'yes';
      const operationCodes = hasCodes ? [...dialogCodes] : [];
      if (!TIPONOrgCore.COOPS.includes(coop) ||
          !TIPONPlatforms.optionsForCoop(coop).some(value => norm(value) === norm(platform)))
        throw Error('Select a valid Cooperative and its Business Platform.');
      if (name.length < 2 || name.length > 80) throw Error('Paygroup must be between 2 and 80 characters.');
      if (hasCodes && !operationCodes.length) throw Error('Add at least one Operation Code or select No.');
      const payload = { id: editing?.id || uuid(), coop, platform, name, operationCodes };
      await TIPONAPI.call({ action: editing ? 'paygroupUpdate' : 'paygroupAdd', paygroup: payload });
      const refreshed = await TIPONSync.refreshDirectory();
      if (refreshed?.ok === false && refreshed?.readOk !== true)
        throw Error(refreshed.error || 'The Paygroup was saved but the central directory refresh did not complete.');
      await loadCollections();
      renderDirectory();
      $('paygroupDialog').close();
      showToast(editing ? 'Paygroup changes confirmed centrally.' : 'Paygroup added to the central directory.', 'success', 7500);
    } catch (error) {
      const message = error?.code === 'ACTION' || /unknown action|unsupported action|not implemented/i.test(String(error?.message || ''))
        ? 'Paygroup endpoints are not installed in the private Apps Script backend. Install backend-patch/README_PAYGROUP.md and redeploy; no central change was confirmed.'
        : String(error?.message || 'Paygroup save failed.');
      setText('paygroupStatus', message);
      showToast(message, 'error', 9500);
    } finally {
      if (button) button.disabled = false;
    }
  }
  async function deletePaygroup(id) {
    if (!isAdmin()) return;
    const pg = byId(id);
    if (!pg) return;
    if (!await confirmAction('Delete Paygroup?', 'Delete ' + pg.name + '? The central server will prevent deletion while a Work Location or member still uses this Paygroup.')) return;
    try {
      if (!navigator.onLine) throw Error('Internet is required to delete a Paygroup.');
      await TIPONAPI.call({ action: 'paygroupDelete', id: pg.id });
      const refreshed = await TIPONSync.refreshDirectory();
      if (refreshed?.ok === false && refreshed?.readOk !== true)
        throw Error(refreshed.error || 'The Paygroup deletion was sent but the central directory refresh did not complete.');
      await loadCollections();
      renderDirectory();
      showToast('Paygroup deletion confirmed centrally.', 'success', 7500);
    } catch (error) {
      const message = error?.code === 'ACTION' || /unknown action|unsupported action|not implemented/i.test(String(error?.message || ''))
        ? 'Paygroup delete endpoint is not installed in the private Apps Script backend. No central deletion was confirmed.'
        : String(error?.message || 'Paygroup deletion failed.');
      showToast(message, 'error', 9500);
    }
  }

  function hideOperationPanel() {
    const panel = $('terminalOperationPanel');
    if (panel) panel.hidden = true;
    if ($('terminalOperationChoices')) $('terminalOperationChoices').replaceChildren();
  }
  function resolveSelection(value) {
    const resolve = pendingSelection;
    pendingSelection = null;
    hideOperationPanel();
    if (resolve) resolve(value || null);
  }
  function cancelPendingSelection() {
    if (pendingSelection) resolveSelection(null);
    else hideOperationPanel();
  }
  function chooseForTimeIn(member, site) {
    const assignedIds = ids(member?.paygroupIds);
    if (!assignedIds.length) {
      hideOperationPanel();
      return Promise.resolve({ paygroupId: '', paygroup: '', operationCode: '' });
    }
    const groups = forMemberAtSite(member, site).slice().sort((a,b) =>
      String(a.name || '').localeCompare(String(b.name || '')));
    if (!groups.length)
      return Promise.reject(Error('Assigned Paygroup is not synchronized to this Work Location. Refresh the directory before Time In.'));

    // A member whose assigned Paygroups do not define Operation Codes can
    // proceed automatically. A Paygroup is still carried into Attendance Logs.
    const codedGroups = groups.filter(pg => codes(pg).length);
    if (!codedGroups.length) {
      hideOperationPanel();
      return Promise.resolve({
        paygroupId: String(groups[0].id),
        paygroup: String(groups[0].name || ''),
        operationCode: ''
      });
    }

    // Show every Operation Code assigned to this member at this Work Location.
    // The selected button also identifies its Paygroup when multiple Paygroups
    // have different Operation Code lists.
    const choices = [];
    codedGroups.forEach(pg => codes(pg).forEach(code => choices.push({
      paygroupId: String(pg.id),
      paygroup: pg.name,
      operationCode: code,
      label: code,
      detail: pg.name,
      kind: 'operation'
    })));
    setText('terminalOperationTitle', 'Select Operation Code');
    setText('terminalOperationHelp', 'Choose an Operation Code to record Time In. Time Out will automatically use the same code.');
    const root = $('terminalOperationChoices');
    if (!root) return Promise.reject(Error('Operation Code selection panel is unavailable. Refresh the attendance app.'));
    root.innerHTML = choices.map(choice =>
      '<button type="button" class="terminal-operation-button" data-paygroup-choice="1" data-paygroup-id="' +
      esc(choice.paygroupId) + '" data-operation-code="' + esc(choice.operationCode) + '">' +
      '<strong>' + esc(choice.label) + '</strong><small>' + esc(choice.detail) + '</small></button>').join('');
    const panel = $('terminalOperationPanel');
    if (panel) {
      panel.hidden = false;
      panel.setAttribute('aria-label', 'Select an Operation Code before Time In');
    }
    return new Promise(resolve => {
      pendingSelection = resolve;
      panel?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
  }

  async function refreshDirectory(kind = 'refresh') {
    if (!navigator.onLine) {
      renderDirectory();
      showToast('Offline: showing the last synchronized Paygroup directory.', 'info');
      return;
    }
    const buttonIds = kind === 'sync' ? ['adminPaygroupSync','userPaygroupSync'] : ['adminPaygroupRefresh','userPaygroupRefresh'];
    buttonIds.forEach(id => { if ($(id)) $(id).disabled = true; });
    try {
      if (kind === 'sync') {
        const result = await TIPONSync.submitPendingNow();
        if (result?.ok === false && result?.readOk !== true) throw Error(result.error || 'Organization synchronization did not complete.');
      }
      const result = await TIPONSync.refreshDirectory();
      if (result?.ok === false && result?.readOk !== true) throw Error(result.error || 'Paygroup directory refresh did not complete.');
      await loadCollections();
      renderDirectory();
      if (window.TIPONAdminSites?.render) window.TIPONAdminSites.render();
      renderMembers();
      renderSites();
      showToast(kind === 'sync' ? 'Paygroup directory synchronized.' : 'Paygroup directory refreshed.', 'success', 6500);
    } catch (error) {
      showToast(error.message || 'Paygroup directory refresh failed.', 'error', 8500);
    } finally {
      buttonIds.forEach(id => { if ($(id)) $(id).disabled = false; });
    }
  }

  function bind() {
    if (window.__tiponPaygroupsBound) return;
    window.__tiponPaygroupsBound = true;
    $('adminPaygroupAdd')?.addEventListener('click', () => openDialog());
    ['admin','user'].forEach(prefix=>{$(`${prefix}PaygroupPrev`)?.addEventListener('click',()=>{directoryPage=Math.max(1,directoryPage-1);renderDirectory();});$(`${prefix}PaygroupNext`)?.addEventListener('click',()=>{directoryPage++;renderDirectory();});});
    $('userPaygroupAdd')?.addEventListener('click', () => openDialog());
    $('adminPaygroupRefresh')?.addEventListener('click', () => refreshDirectory('refresh'));
    $('userPaygroupRefresh')?.addEventListener('click', () => refreshDirectory('refresh'));
    $('adminPaygroupSync')?.addEventListener('click', () => refreshDirectory('sync'));
    $('userPaygroupSync')?.addEventListener('click', () => refreshDirectory('sync'));
    $('adminPaygroupRows')?.addEventListener('click', event => {
      const edit = event.target.closest('[data-paygroup-edit]');
      const remove = event.target.closest('[data-paygroup-delete]');
      const view = event.target.closest('[data-paygroup-view-codes]');
      if (edit) openDialog(byId(edit.dataset.paygroupEdit));
      if (remove) void deletePaygroup(remove.dataset.paygroupDelete);
      if (view) openOperationCodeView(view.dataset.paygroupViewCodes);
    });
    $('userPaygroupRows')?.addEventListener('click', event => {
      const edit = event.target.closest('[data-paygroup-edit]');
      const view = event.target.closest('[data-paygroup-view-codes]');
      if (edit && state.user?.role === 'registrar') openDialog(byId(edit.dataset.paygroupEdit));
      if (view) openOperationCodeView(view.dataset.paygroupViewCodes);
    });
    $('paygroupCodesViewClose')?.addEventListener('click', () => $('paygroupCodesViewDialog')?.close());
    $('paygroupCodesViewDone')?.addEventListener('click', () => $('paygroupCodesViewDialog')?.close());
    $('paygroupForm')?.addEventListener('submit', savePaygroup);
    $('paygroupHasOperationCodes')?.addEventListener('change', toggleOperationCodeFields);
    $('paygroupAddOperationCode')?.addEventListener('click', addOperationCode);
    $('paygroupOperationCodeInput')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); addOperationCode(); }
    });
    $('paygroupOperationCodes')?.addEventListener('click', event => {
      const remove = event.target.closest('[data-remove-operation-code]');
      if (!remove) return;
      dialogCodes.splice(Number(remove.dataset.removeOperationCode), 1);
      renderOperationCodeChips();
    });
    $('paygroupCoop')?.addEventListener('change', () => TIPONPlatforms.fillScoped('paygroupCoop','paygroupPlatform',''));
    $('siteCoop')?.addEventListener('change', () => fillSitePicker());
    $('sitePlatform')?.addEventListener('change', () => fillSitePicker());
    $('sitePaygroupChoices')?.addEventListener('change', () => updatePickerSummary('sitePaygroupChoices','sitePaygroupSummary'));
    $('memberCoop')?.addEventListener('change', () => fillMemberPicker('user', readPicker('memberPaygroupChoices')));
    $('memberPlatform')?.addEventListener('change', () => refreshMemberPicker('user'));
    $('memberSiteChoices')?.addEventListener('change', () => refreshMemberPicker('user'));
    $('memberPaygroupChoices')?.addEventListener('change', () => updatePickerSummary('memberPaygroupChoices','memberPaygroupSummary'));
    $('adminMemberCoop')?.addEventListener('change', () => fillMemberPicker('admin', readPicker('adminMemberPaygroupChoices')));
    $('adminMemberPlatform')?.addEventListener('change', () => refreshMemberPicker('admin'));
    $('adminMemberSiteChoices')?.addEventListener('change', () => refreshMemberPicker('admin'));
    $('adminMemberPaygroupChoices')?.addEventListener('change', () => updatePickerSummary('adminMemberPaygroupChoices','adminMemberPaygroupSummary'));
    $('terminalOperationChoices')?.addEventListener('click', event => {
      const button = event.target.closest('[data-paygroup-choice]');
      if (!button) return;
      resolveSelection({
        paygroupId: String(button.dataset.paygroupId || ''),
        paygroup: byId(button.dataset.paygroupId)?.name || '',
        operationCode: String(button.dataset.operationCode || '')
      });
    });
    $('terminalOperationCancel')?.addEventListener('click', () => resolveSelection(null));
    $('terminalOperationPanel')?.addEventListener('close', cancelPendingSelection);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelPendingSelection(); });
    renderDirectory();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
  return {
    bind, renderDirectory, openOperationCodeView, openAssignedPaygroupsView, groupsForMember, namesForSite, namesForMember, locationsForPaygroup, groupsForScope, canCreatePaygroup,
    fillSitePicker, refreshSitePicker: () => fillSitePicker(), fillMemberPicker, refreshMemberPicker,
    readPicker, validateSiteAssignment, validateMemberAssignment, chooseForTimeIn, hideOperationPanel,
    cancelPendingSelection, forMemberAtSite
  };
})();
