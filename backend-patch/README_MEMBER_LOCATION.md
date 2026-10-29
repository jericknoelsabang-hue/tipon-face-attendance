# TIPON KABILANG v5.5.39 — Private Apps Script compatibility patch

This patch is for the **existing private Google Apps Script project** behind the TIPON Face Attendance `/exec` URL. GitHub Pages cannot deploy Apps Script. Do not paste credentials, Script Properties, tokens, deployment IDs, member data, or face data into this public repository.

## What this patch adds

- Admin/User member editing: edit Member ID, Full Name, Cooperative, Business Platform and required Assigned Work Location in one revision-checked operation. Member ID is a unique business identifier; the internal record key and historical attendance remain unchanged.
- User member transfer: the source member must be in the User's current scope; the destination site must exist centrally and match the selected Cooperative/BP. After transfer, the User loses access if the member leaves their scope.
- User face re-enrollment: save the newly encrypted AES-GCM face template, consent timestamp and Member ID without replacing the internal record key or attendance history. The server records the enrolling account itself.
- Attendance Logs Edit/Delete: audited correction overlays, server-side scope checks, revision checks, open-session protection and cross-device refresh.
- Existing member soft delete and Work Location operations remain separate.

## 1. Back up the live project

1. Open the approved TIPON attendance spreadsheet → **Extensions → Apps Script**.
2. Confirm the project is the same project used by the existing `/exec` URL.
3. Make a copy of `Code.gs`, `OrgCore.gs`, `appsscript.json`, and the current Script Properties. Do not change the spreadsheet ID, encryption keys, deployment ID or permissions.
4. In Project Settings, verify the Apps Script V8 runtime. Do not replace the entire live `Code.gs` with an older backup.

## 2. Add the helper files

Create two new files in the existing Apps Script project and copy the matching repository files into them:

- [MemberLocationEdit.gs](./MemberLocationEdit.gs)
- [AttendanceCorrection.gs](./AttendanceCorrection.gs)

Before saving, search the live project for these function names. If any are already defined, reconcile the code instead of creating duplicate definitions:

- `tp5AdminMemberUpdateV2_`
- `tp5UserMemberLocationUpdate_`
- `tp5UserMemberDelete_`
- `tp5UserMemberTransferUpdateV2_`
- `tp5UserMemberFaceUpdateV2_`
- `tp5AttendanceCorrect_`
- `tp5RebuildAttendanceProjection_`
- `tp5ApplyAttendanceCorrections_`

## 3. Add the action routes to the CURRENT Code.gs

Inside `tp5Handle_(q, transport)`, after the setup/health checks and before the authenticated action routes, add the capability route if it is missing:

~~~js
if(action==='memberLocationCapabilities'){
  tp5Must_(props.getProperty('TP5_SETUP_STATUS')==='READY',
    'Organization setup is incomplete.','NOT_CONFIGURED');
  return tp5Reply_({memberLocationUpdate:true,allowUnassignedFace:false,memberTransferUpdate:true,memberFaceUpdate:true,adminMemberUpdate:true,memberIdEditable:true});
}
~~~

After the existing `var actor=tp5Auth_(q);` line, add each route that is not already present:

~~~js
if(action==='adminMemberUpdateV2')return tp5Lock_(function(){
  actor=tp5Auth_(q);return tp5AdminMemberUpdateV2_(actor,q);
});
if(action==='memberLocationUpdate')return tp5Lock_(function(){
  actor=tp5Auth_(q);return tp5UserMemberLocationUpdate_(actor,q);
});
if(action==='memberUserDelete')return tp5Lock_(function(){
  actor=tp5Auth_(q);return tp5UserMemberDelete_(actor,q);
});
if(action==='memberTransferLocations')return tp5Lock_(function(){
  actor=tp5Auth_(q);return tp5UserMemberTransferLocations_(actor,q);
});
if(action==='memberTransferUpdateV2')return tp5Lock_(function(){
  actor=tp5Auth_(q);return tp5UserMemberTransferUpdateV2_(actor,q);
});
if(action==='memberFaceUpdateV2')return tp5Lock_(function(){
  actor=tp5Auth_(q);return tp5UserMemberFaceUpdateV2_(actor,q);
});
if(action==='attendanceCorrect')return tp5Lock_(function(){
  actor=tp5Auth_(q);return tp5AttendanceCorrect_(actor,q);
});
~~~

Keep existing login, logout, `submit`, `catalog`, `poll`, `adminMemberDelete`, account, device and setup routes intact.

## 4. Apply two attendance polling changes

### A. Apply corrections to event rows

In the existing `tp5EventWindow_(offset,count)` function, keep its current row-fetching logic. Change only the final `return rows;` inside that function to:

~~~js
return tp5ApplyAttendanceCorrections_(rows);
~~~

This returns the audited corrected view to clients while retaining the raw event ledger.

### B. Include the correction version in poll responses

In the existing `action==='poll'` response object, add this property if absent:

~~~js
eventVersion:Number(tp5Props_().getProperty('TP5_EVENT_VERSION')||0)
~~~

Keep the existing `events`, `cursor`, `eventCount`, `more`, `catalogVersion` and `devices` fields. The frontend uses the event version to re-read corrected sessions on other authorized devices.

## 5. Preserve required location and face controls

The current UI requires at least one centrally registered Assigned Work Location. Do not loosen server-side checks to accept an empty site list. Keep these protections:

- AES-GCM encrypted templates only; never accept plaintext descriptors from the browser.
- Required biometric consent timestamp.
- Source member must be in the User's current authorized scope before a transfer or face update.
- Target locations must exist centrally and match the selected Cooperative/BP.
- Revision conflicts, duplicate Member IDs, deleted sites, invalid GPS zones and open Time In sessions must be rejected.
- Raw attendance events remain intact; corrections are stored as audited overlays.
- User delete remains a soft delete of the member/template, with attendance history retained.

## 6. Deploy the existing Web App

1. Save the project and resolve any duplicate function names or syntax errors.
2. Select **Deploy → Manage deployments → Edit** on the existing Web App deployment.
3. Select **New version → Deploy**.
4. Keep the same deployment ID, `/exec` URL and access permissions.
5. In the published app, open [TIPON App Updater](https://jericknoelsabang-hue.github.io/tipon-face-attendance/update.html), install the latest published frontend, then sign in again.

A GitHub Pages success badge does **not** prove that the private Apps Script has been deployed.

## 7. Test before production

Use synthetic member IDs and test accounts first:

- Create a new member, capture three face samples, save and verify a server ACK.
- Change a test member's Member ID through both Admin Edit and User Transfer; confirm the immutable internal key and attendance history are unchanged, and duplicate IDs are rejected.
- Re-enroll a test member's face; confirm the Member ID, attendance history and consent are retained and the encrypted template changes.
- Transfer a member to another Cooperative/BP with a valid destination Work Location. Confirm the old User loses access after the member leaves their scope.
- Edit, delete and review a completed attendance session. Confirm correction reason, server revision and second-device view.
- Confirm open Time In deletion/reassignment is blocked.
- Turn off internet, queue a test change, restore internet and verify the queue resolves to **Synced** or displays a specific **Needs Review** reason.
- Verify a filter with no matching date/member shows an empty-state explanation; use Reset Filters to view all records.

Do not clear production IndexedDB, member records, face templates, pending uploads or historical attendance to make the UI appear empty or error-free.
