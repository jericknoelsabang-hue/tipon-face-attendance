# TIPON KABILANG v5.5.85 — Private Apps Script compatibility patch

This patch is for the **existing private Google Apps Script project** behind the TIPON Face Attendance `/exec` URL. GitHub Pages cannot deploy Apps Script. Do not paste credentials, Script Properties, tokens, deployment IDs, member data, or face data into this public repository.

## What this patch adds

- Admin/User member editing: edit Member ID, Full Name, Cooperative, Business Platform, weekly work days/hours and required Assigned Work Location in one revision-checked operation. Member ID is a unique business identifier; the internal record key and historical attendance remain unchanged.
- User member transfer: the source member must be in the User's current scope; the destination site must exist centrally and match the selected Cooperative/BP. After transfer, the User loses access if the member leaves their scope.
- Existing member Work Schedule edits through the legacy `memberTransferUpdateV2` endpoint: the endpoint must accept `workSchedule` and persist it without requiring face capture or replacing the encrypted face template. This is required to clear old “Only identity and assignment fields may be edited” rejections.
- User face re-enrollment: save the newly encrypted AES-GCM face template, consent timestamp and Member ID without replacing the internal record key or attendance history. The server records the enrolling account itself.
- Attendance Logs Edit/Delete: audited correction overlays, server-side scope checks, revision checks and cross-device refresh. Admins and authorized Users can edit Date, Time In, Date Time Out and Time Out, including adding a missing Time Out to an open session, or delete an open or completed session.
- Weekly member Work Schedules (days, start/end times and grace minutes) are revision-checked, validated by `tp5MemberWorkScheduleV2_`, and stored in both the nested API object and the `workDays`, `workStart`, `workEnd`, `workGrace` and `workScheduleText` sheet columns. Both Admin and User use the dedicated, audited `memberWorkScheduleUpdateV2` route for schedule-only changes, without modifying biometric templates, MPC/BP, Assigned Location or historical attendance. Scope changes still use the existing authorized member-update routes.

### Member sheet columns

Add these columns to the member sheet used by the live Apps Script before deploying the patch: `workDays`, `workStart`, `workEnd`, `workGrace`, and `workScheduleText`. The patch writes the normalized nested `workSchedule` plus these flattened values so the schedule is visible in Google Sheets and survives catalog refreshes.

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

- `tp5MemberWorkScheduleUpdateV2_`
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
  return tp5Reply_({memberLocationUpdate:true,allowUnassignedFace:false,memberTransferUpdate:true,memberFaceUpdate:true,adminMemberUpdate:true,memberIdEditable:true,memberWorkScheduleUpdate:true});
}
~~~

After the existing `var actor=tp5Auth_(q);` line, add each route that is not already present:

~~~js
if(action==='memberWorkScheduleUpdateV2')return tp5Lock_(function(){
  actor=tp5Auth_(q);return tp5MemberWorkScheduleUpdateV2_(actor,q);
});
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
- Edit all four date/time fields on a completed session and confirm the corrected times appear on a second device.
- Add a Time Out to a test open session through Edit Attendance; confirm the audited synthetic OUT appears in the central report and on a second device.
- Delete a test open session and a completed session; confirm raw events remain in the ledger while the corrected view hides the deleted session.
- Confirm overlapping sessions, future times, duplicate corrections and unauthorized scope changes remain blocked.
- Turn off internet, queue a test change, restore internet and verify the queue resolves to **Synced** or displays a specific **Needs Review** reason.
- Verify a filter with no matching date/member shows an empty-state explanation; use Reset Filters to view all records.

Do not clear production IndexedDB, member records, face templates, pending uploads or historical attendance to make the UI appear empty or error-free.

## Weekly Work Schedule — Admin and User activation (v5.5.85)

**Important:** GitHub Pages automatically publishes the frontend, but **does not deploy private Apps Script**. The rejection "Only approved member fields and Assigned Location can be edited" indicates the currently published Apps Script is older than this route. Updating GitHub alone cannot clear that rejection.

1. Back up the existing Apps Script project and confirm it is the one serving the current `/exec` URL.
2. Update the **existing** `MemberLocationEdit.gs` with the matching source above, preserving your live `Code.gs`, `OrgCore.gs`, Script Properties, encryption keys and member data. Do not create duplicate functions.
3. Add the authenticated and locked `memberWorkScheduleUpdateV2` route to the existing `tp5Handle_(q,transport)` as shown in Section 3; do **not** create an anonymous public endpoint. Confirm the existing V2 identity/transfer routes have the updated `workSchedule` validators.
4. Confirm member-sheet columns: `workDays`, `workStart`, `workEnd`, `workGrace`, `workScheduleText`.
5. Select **Deploy → Manage deployments → Edit → New version → Deploy** in Apps Script, keeping the same deployment and access rules. Do not substitute a newly created URL without migrating the approved clients.
6. With test members and approved accounts: Admin edits days/hours and saves; User edits a member in their assigned MPC/BP; both receive an acknowledged updated schedule and `rev`. Refresh a second device and confirm the schedule persists and matches the sheet columns. Check that a User cannot edit an out-of-scope member, a stale revision is rejected, and face/attendance data are unchanged. Test the offline queue once the server is live.

For **schedule-only** saves, the frontend requests `memberWorkScheduleUpdateV2` with `memberId`, `baseRev` and `workSchedule`. If the route is unavailable, the UI reports a backend deployment requirement rather than claiming central sync success. Offline edits can remain queued until connectivity returns; rejected edits are restored and marked for review.
