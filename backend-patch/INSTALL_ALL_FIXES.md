# TIPON KABILANG v5.5.25 — Activate all three fixes

**What GitHub Pages can deploy automatically:** Work Location deletion using the existing authenticated `submit` API (including reconciliation of a previously unconfirmed Work Location edit), and accurate Member List error handling.

**What requires a private Google Apps Script deployment:** Saving Assigned Location for a **NOT ENROLLED** member without capturing a face, replacing/removing a User's existing assigned site, and editing Assigned Location from the Admin account. These actions do not exist in the older server. A GitHub push cannot create them.


**Live version check (October 28, 2026):** The Apps Script editor currently open in the owner's browser displays a `TIPON v5.5.2` Code.gs header, while GitHub Pages has moved to v5.5.25. These new backend actions cannot work until that older private deployment is updated. The server patch was reviewed against a separately supplied v5.5.9 reference, **not** against the entire live 5.5.2 source. Verify the current project helper signatures and the Apps Script **V8 runtime** in Project Settings before deploying; test any required runtime migration in a copy before changing production.

## Required permissions

Use an account that can edit the **existing bound Apps Script project** behind the TIPON Organization Attendance web app. GitHub Pages access alone does not grant permission to deploy Apps Script. Keep that project, its spreadsheet, deployment ID, Script Properties, face encryption keys, and all historical records unchanged.

## One-time installation

1. In the approved attendance spreadsheet, click **Extensions → Apps Script**. Verify this is the **same project** as the `/exec` URL connected to the TIPON app. Back up `Code.gs`, `OrgCore.gs`, and Script Properties. Do not paste secrets into GitHub.
2. Create a new file **MemberLocationEdit.gs**. Paste [MemberLocationEdit.gs](./MemberLocationEdit.gs) from this repository into it. This contains three authenticated server handlers and scope / member-revision checks.
3. In the **CURRENT** `Code.gs`, find `tp5Handle_(q,transport)`. Insert this capability route just before the existing `var actor=tp5Auth_(q);` (after the setup/health checks):

   ```js
   if(action==='memberLocationCapabilities'){
     tp5Must_(props.getProperty('TP5_SETUP_STATUS')==='READY',
       'Organization setup is incomplete.','NOT_CONFIGURED');
     return tp5Reply_({allowUnassignedFace:true,memberLocationUpdate:true});
   }
   ```

4. After the existing `var actor=tp5Auth_(q);`, alongside the current authenticated `adminMemberUpdate` route, add all three routes:

   ```js
   if(action==='adminMemberUpdateV2')return tp5Lock_(function(){
     actor=tp5Auth_(q);return tp5AdminMemberUpdateV2_(actor,q);
   });
   if(action==='memberLocationUpdate')return tp5Lock_(function(){
     actor=tp5Auth_(q);return tp5UserMemberLocationUpdate_(actor,q);
   });
   if(action==='memberUserDelete')return tp5Lock_(function(){
     actor=tp5Auth_(q);return tp5UserMemberDelete_(actor,q);
   });
   ```

5. To support **enrolled members with no assigned location**, apply the **two narrowly scoped validation changes** in [README_MEMBER_LOCATION.md](./README_MEMBER_LOCATION.md), section 3. Preserve the existing encrypted face, consent, authorization, duplicate-enrollment and GPS controls.
6. In the Apps Script editor, **Save**, then **Deploy → Manage deployments → Edit the existing Web App → New version → Deploy**. Keep the current deployment ID, `/exec` URL and approved access settings. **Do not deploy to a new URL** unless the organization owner explicitly wants that migration.
7. In GitHub Pages open [the TIPON updater](https://jericknoelsabang-hue.github.io/tipon-face-attendance/update.html) and install v5.5.25. Fully reload and sign in again.

## Verification checklist — synthetic records only

- **Admin Assigned Location:** Edit a test NOT ENROLLED member's site IDs, Save, refresh the page, then check the change on a second authorized device. Confirm no face was enrolled and no attendance history changed.
- **User Assigned Location:** Test a location-only edit for a test NOT ENROLLED member and an enrolled member; then test clearing a site. All need a central ACK and must retain identity and biometric status.
- **Work Location deletion:** Test an unassigned location with a previously rejected/pending edit. After confirmation, it must disappear from the central site directory, with only the matching local site operation removed. Other pending member operations must remain untouched.
- **Negative cases:** A cross-MPC/BP reassignment, duplicate/stale member revision, assigned site deletion, open Time In, and offline save must be blocked without losing data.
- **Consistency:** Review `TIPON Members` and `TIPON Attendance` views and check a second device. Do not treat a green connection indicator alone as proof of successful data synchronization.

**Status rule:** Until the private Apps Script has been redeployed and checked against the live organization, the two member Assigned Location features are **not production-ready**. The UI must not hide an unacknowledged write or report it as synced.

## Source compatibility warning

The backend helpers were reviewed against the user's previous `TIPON_Code_v5_5_9.gs`. They have **not** been deployed to or verified against a newer live private Apps Script project. Merge only the listed server routes/validator changes into the current project; never replace the entire project with an older file.
