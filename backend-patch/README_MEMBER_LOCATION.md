# TIPON KABILANG — Assigned Location backend (v5.5.20)

This patch enables the **Admin Member Details → Assigned Location** selector and a **User changing an existing member's Work Location without re-enrolling the face**. Assigned Location is optional. Attendance still requires an enrolled face and an approved site.

**Important:** GitHub Pages updates ONLY the public frontend; private Google Apps Script is separately deployed. Do not publish Code.gs, Script Properties, keys, tokens, or member/face data. This guide uses the earlier TIPON_Code_v5_5_9.gs provided by the user. Review the actual current Code.gs before merging. Never replace a newer deployed Code.gs with the older backup.

## 1. Install the server file

Open the approved TIPON Attendance Google Sheet → Extensions → Apps Script. Back up Code.gs, OrgCore.gs, manifest and Script Properties. Add a file named **MemberLocationEdit.gs** containing [MemberLocationEdit.gs](./MemberLocationEdit.gs) from this repository.

This file defines two operations with central verification, revision conflict checks, MPC/BP authorization and open-Time-In protection:

- tp5AdminMemberUpdateV2_(actor,q): edit member identity, Cooperative, Business Platform and optional 0–40 Assigned Locations atomically; do not change face templates.
- tp5UserMemberLocationUpdate_(actor,q): authorized User updates only GPS assignments for a member in the approved scope; face enrollment status is preserved.

## 2. Add three routes to the CURRENT private Code.gs

In tp5Handle_(q,transport), immediately after the health route and before token authentication, add:

~~~js
if(action==='memberLocationCapabilities'){
  tp5Must_(props.getProperty('TP5_SETUP_STATUS')==='READY',
    'Organization setup is incomplete.','NOT_CONFIGURED');
  return tp5Reply_({allowUnassignedFace:true});
}
~~~

After the existing var actor=tp5Auth_(q);, close to the other authenticated admin actions, add:

~~~js
if(action==='adminMemberUpdateV2')return tp5Lock_(function(){
  actor=tp5Auth_(q);
  return tp5AdminMemberUpdateV2_(actor,q);
});
if(action==='memberLocationUpdate')return tp5Lock_(function(){
  actor=tp5Auth_(q);
  return tp5UserMemberLocationUpdate_(actor,q);
});
~~~

Keep the old adminMemberUpdate, adminMemberDelete, submit, member-lookup and attendance routes unchanged. The V2 route is separate to protect older clients.

## 3. Permit optional site for facial enrollment (existing Code.gs)

Inside tp5ValidateEntity_(actor,type,value,previous), in the non-import member branch, replace the old location validation:

~~~js
var ids=Array.isArray(r.siteIds)&&r.siteIds.length?r.siteIds:[r.siteId];
tp5Must_(ids.length>0&&ids.length<=40&&ids[0]===r.siteId&&
  ids.every(function(id){return typeof id==='string'&&id.length>0;})&&new Set(ids).size===ids.length,
  'User must select one or more unique assigned work locations.','VALIDATION');
~~~

with:

~~~js
var ids=Array.isArray(r.siteIds)?r.siteIds:[r.siteId].filter(Boolean);
tp5Must_(ids.length<=40&&
  (ids.length?ids[0]===r.siteId:!r.siteId)&&
  ids.every(function(id){return typeof id==='string'&&id.length>0;})&&
  new Set(ids).size===ids.length,
  'Assigned Work Location must be unique and valid (or empty).','VALIDATION');
~~~

At the end of the SAME member branch, replace:

~~~js
r.siteIds=ids;r.siteId=ids[0];r.active=true;
~~~

with:

~~~js
r.siteIds=ids;r.siteId=ids[0]||'';r.active=true;
r.workLocationReassignmentRequired=ids.length===0;
~~~

Do **not** remove the AES-GCM encrypted face template requirement, consent validation, duplicate member checks, role authorization, or scope checks. A member without an assigned site cannot record Time In/Out even when face-enrolled.

If the current Code.gs differs from the older v5.5.9 source, reconcile the member validator against the newer source instead of blindly pasting this replacement.

## 4. Deploy and test

Save, check for duplicate helper definitions, and choose **Deploy → Manage deployments → Edit existing attendance web app → New version → Deploy**. Keep the same deployment ID, URL and permissions.

Test with synthetic records and approved test accounts BEFORE production:

1. User edits the Assigned Work Location of a NOT ENROLLED member, preserving identity and existing face status.
2. User removes all Work Locations, leaving the member unassigned. Member must not be able to Time In.
3. User enrolls a face without a location. Verify encrypted template and consent persist, attendance remains blocked until site assignment.
4. Admin edits an enrolled member's Assigned Location; verify existing face template, consent, attendance logs and member ID remain unchanged.
5. Admin changes MPC/BP and assigns a valid location in the new scope in one transaction.
6. Cross-scope, deleted-site, stale-baseRev, and open-Time-In reassignments must be rejected.
7. Verify the central TIPON Members projection and a second authorized device reflect the saved changes.
8. Re-test kiosk face recognition, GPS, member access, and 90-second inactive logout.

If these routes are not installed, the frontend intentionally shows a backend-required error rather than falsely reporting that the member's assigned location was saved.

## User interface changes

v5.5.20 also uses black dropdown text, a consistent chevron on all native and custom dropdowns, and green Confirm buttons (including deletion confirmation, while retaining the separate confirmation step).
