/* Shared deterministic attendance projection. Same five columns for Sheets and Excel. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TIPONCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const HEADERS = Object.freeze(['Member ID', 'Business platform', 'Work location', 'Time In', 'Time Out']);
  const epoch = value => { const t = Date.parse(value); if (!Number.isFinite(t)) throw Error('Invalid attendance timestamp.'); return t; };
  function phStamp(value) { return value ? new Date(epoch(value) + 28800000).toISOString().slice(0, 19).replace('T', ' ') : ''; }
  function serial(value) { return value ? (epoch(value) + 28800000) / 86400000 + 25569 : ''; }
  function normalize(punches, deviceId) {
    const open = new Map();
    return [...punches].filter(p=>!p.deleted&&p.reviewStatus!=='rejected').sort((a,b) => epoch(a.timestamp) - epoch(b.timestamp) || String(a.id).localeCompare(String(b.id))).map(p => {
      const item = {...p, deviceId:p.deviceId || deviceId, memberId:String(p.memberId)};
      const key = JSON.stringify([item.deviceId, item.memberId, item.siteId || item.siteName || item.location]);
      if (item.type === 'IN') {
        item.sessionId = item.sessionId || item.id;
        open.set(key, item);
      } else if (item.type === 'OUT') {
        item.sessionId = item.sessionId || open.get(key)?.sessionId || 'orphan-' + item.id;
        open.delete(key);
      } else throw Error('Attendance type must be IN or OUT.');
      return item;
    });
  }
  function publicEvent(p) {
    return {id:p.id, deviceId:p.deviceId, sessionId:p.sessionId, memberId:String(p.memberId),
      platform:p.platform || '', location:p.location ?? p.siteName ?? '', type:p.type, timestamp:p.timestamp};
  }
  function rows(punches, deviceId) {
    const groups = new Map(), ids = new Set();
    for (const p of normalize(punches, deviceId)) {
      if (ids.has(p.id)) continue;
      ids.add(p.id);
      const key = JSON.stringify([p.sessionId]);
      const loc = p.location ?? p.siteName ?? '';
      const row = groups.get(key) || {key, deviceId:p.deviceId, memberId:p.memberId, platform:p.platform || '',
        location:loc, siteId:p.siteId || '', timeIn:'', timeOut:'', eventIds:[]};
      if (row.memberId !== p.memberId || row.location !== loc)
        throw Error('A session has conflicting member or work location data. Review local records.');
      const col = p.type === 'IN' ? 'timeIn' : 'timeOut';
      if (row[col]) throw Error('Duplicate time ' + p.type.toLowerCase() + ' in a session. Review records.');
      row[col] = p.timestamp; row.eventIds.push(p.id); groups.set(key, row);
    }
    const result = [...groups.values()];
    for (const r of result) if (r.timeIn && r.timeOut && epoch(r.timeOut) < epoch(r.timeIn)) throw Error('Time Out precedes Time In.');
    return result.sort((a,b) => epoch(a.timeIn || a.timeOut) - epoch(b.timeIn || b.timeOut) || a.key.localeCompare(b.key));
  }
  function table(data, numericDates = false) {
    const date = numericDates ? serial : phStamp;
    return [HEADERS.slice(), ...data.map(r => [r.memberId, r.platform || '', r.location, date(r.timeIn), date(r.timeOut)])];
  }
  function filterRows(data, from, to, site) {
    if (from && to && from > to) throw Error('From date must not be after To date.');
    return data.filter(r => {
      const day = phStamp(r.timeIn || r.timeOut).slice(0,10);
      return (!from || day >= from) && (!to || day <= to) && (!site || r.siteId === site);
    });
  }
  function resolveModeForDate(punches, memberId, mode, now = Date.now()) {
    if (!['in','out'].includes(mode)) throw Error('Choose Time In or Time Out.');
    const last = punches.filter(p => !p.deleted&&p.reviewStatus!=='rejected'&&String(p.memberId) === String(memberId))
      .sort((a,b) => epoch(b.timestamp) - epoch(a.timestamp))[0];
    const currentDay = phStamp(new Date(now).toISOString()).slice(0,10);
    const previousDay = last ? phStamp(last.timestamp).slice(0,10) : '';
    // If the previous shift was already closed on an earlier Philippine date,
    // a stale Time Out selection starts the new day's shift with Time In.
    // An overnight Time In is intentionally left open so the next-day Time Out remains possible.
    const switched = mode === 'out' && last?.type === 'OUT' && previousDay < currentDay;
    return {mode:switched?'in':mode,switched,last,previousDay,currentDay};
  }
  function transition(punches, memberId, mode, now = Date.now(), cooldown = 90000) {
    const resolved = resolveModeForDate(punches, memberId, mode, now);
    mode = resolved.mode;
    const last = resolved.last;
    const type = mode.toUpperCase();
    if (last && epoch(last.timestamp) > now) throw Error('Device clock is earlier than the previous attendance. Correct the clock first.');
    if (last?.type === type) throw Error(type === 'IN' ? 'Already timed in. Select Time Out after the shift.' : 'Already timed out today. Select Time In for the next shift.');
    if (type === 'OUT' && !last) throw Error('No Time In on this device. Use the same attendance phone for both punches.');
    const lastDay = last ? phStamp(last.timestamp).slice(0,10) : '';
    if (last && lastDay === resolved.currentDay && now - epoch(last.timestamp) < cooldown)
      throw Error('Duplicate protection: wait at least 90 seconds between punches.');
    return {type,last,mode,dateSwitched:resolved.switched,previousDay:resolved.previousDay,currentDay:resolved.currentDay};
  }
  return {HEADERS, phStamp, serial, normalize, publicEvent, rows, table, filterRows, resolveModeForDate, transition};
});
