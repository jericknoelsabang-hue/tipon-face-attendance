# TIPON KABILANG — Paygroup and Operation Code integration

This is a private Apps Script compatibility patch for the existing attendance Web App. GitHub Pages does not deploy the Apps Script receiver. Do not replace Code.gs or create a new Web App deployment.

## Backend file

Add `Paygroups.gs` to the existing Apps Script project. It stores the Paygroup directory in Script Properties under `TP5_PAYGROUP_DIRECTORY`, protected by the existing document lock and Admin authorization.

## Route integration

Inside the current `tp5Handle_(q, transport)`, after setup checks and before normal routes, add:

```js
if(action==='paygroups'){
  tp5Must_(props.getProperty('TP5_SETUP_STATUS')==='READY','Organization setup is incomplete.','NOT_CONFIGURED');
  return tp5PGList_(tp5Auth_(q));
}
```

After the existing `var actor=tp5Auth_(q);` add:

```js
if(action==='paygroupAdd')return tp5Lock_(function(){actor=tp5Auth_(q);return tp5PGAdd_(actor,q);});
if(action==='paygroupUpdate')return tp5Lock_(function(){actor=tp5Auth_(q);return tp5PGUpdate_(actor,q);});
if(action==='paygroupDelete')return tp5Lock_(function(){actor=tp5Auth_(q);return tp5PGDelete_(actor,q);});
```

The catalog action must include the scope-filtered directory:
```js
paygroups: tp5PGCatalog_(actor),
paygroupDirectorySupported: true,
```

Do not expose all paygroups to User accounts. The authenticated User receives only their approved Cooperative + Business Platform scope.

## Required record integration before payroll use

The directory handlers are only one part of the change. Integrate these helpers into the existing authenticated write paths; do not bypass the existing authorization, revision checks, open-session checks or audit trail.

### 1. Work Location writes

In the existing server-side site create/update validator, normalize the incoming field before saving:

```js
value.paygroupIds = tp5SitePaygroupIds_(value.paygroupIds || [], {
  coop: value.coop,
  platform: value.platform
});
```

Keep `paygroupIds` in the saved site record and return it in the catalog. This validates that each Paygroup belongs to the same Cooperative and Business Platform as the Work Location.

### 2. Member writes

The updated repository patches `MemberMetadata.gs` and `MemberFaceTransfer.gs` accept `paygroupIds` in Admin/User metadata edits and face updates. They call:

```js
tp5PaygroupIds_(c.paygroupIds === undefined ? old.paygroupIds : c.paygroupIds, {
  coop: coop,
  platform: platform,
  siteIds: siteIds
});
```

This checks that each selected Paygroup belongs to the member's Cooperative/BP and is assigned to at least one of the member's selected Work Locations. Preserve the field in the saved member object and the catalog. When a location-only update moves a member, validate the existing Paygroup assignment against the new location set; do not silently discard it.

### 3. Member CSV Paygroup import

The updated `MemberCSVImport.gs` accepts `paygroupIds` alongside the required weekly work schedule. The eight-column CSV template is:

`Member ID, Full name, Cooperative, Business platform, Paygroup, Work Days, Work Start, Work End`

The Paygroup cell is optional. When a member has more than one Paygroup, enter the exact registered Paygroup names separated by semicolons (for example, `Daily;Night Shift`). Resolve each name only within the row's Cooperative and Business Platform; reject unknown or duplicate names before sending the batch.

CSV-imported members do not yet have a Work Location. The import helper therefore calls `tp5PaygroupIds_(..., {coop, platform, siteIds: [], allowUnassigned: true})`. This still verifies that every Paygroup is assigned to at least one active Work Location in the same Cooperative/BP. When an authorized User later assigns a member's Work Location, the normal member update validator must verify that the selected Paygroups are also assigned to that exact Work Location.

The existing health response must expose both import capabilities. Include the result of `verifyTIPONMemberCSVScheduleSupport()` and return `memberImportPaygroup: typeof tp5PaygroupIds_ === 'function' && typeof tp5SamePaygroupIds_ === 'function'`. The import response must return `memberImportWorkSchedule: true` and `memberImportPaygroup: true` only after the server has persisted the Paygroup IDs and schedule.

### 4. Attendance event validation

At the existing server-side event-ingestion point, after resolving the authenticated member and the GPS-matched Work Location:

- For `IN`, replace the client values with the result of `tp5ValidateTimeInPaygroup_(member, site, event)`. This checks the member/site assignment and verifies the Operation Code against the Paygroup's configured list.
- For `OUT`, call `tp5InheritTimeOutPaygroup_(event)` using the original Time In session. Never trust a new client-supplied Operation Code for Time Out.
- Store `paygroupId`, `paygroup`, and `operationCode` on the event row. Preserve these fields in event polling, attendance correction overlays and session projection.

A member without a Paygroup may continue without one (blank fields). A Paygroup with no Operation Codes accepts Time In with a blank Operation Code. A Paygroup with configured codes requires one valid code.

### 5. Attendance and member sheet columns

The linked spreadsheet now has these additional headers appended without moving the existing columns:

- `TIPON Attendance v5`: I = Paygroup, J = Operation Code
- `TIPON Members`: L = Paygroup

Update the existing `OrgCore.gs` report header/row writer and any Apps Script `setValues` mapping to append these values after the current BP column. Keep the first eight attendance columns unchanged. Update member directory write/read mapping so column L is populated from the member's assigned Paygroup names.

### 6. Catalog and routes

- The `paygroups` action returns `tp5PGCatalog_(actor)`, including the linked `siteIds` needed by scoped kiosk/User clients.
- The catalog action must also return `paygroups: tp5PGCatalog_(actor)` and `paygroupDirectorySupported: true`.
- Keep Admin-only add/edit/delete routes server-authorized. A User may only view and assign Paygroups within their approved Cooperative/BP. A kiosk may only receive Paygroups associated with its approved Work Locations.

## Deployment and QA

1. Back up current Code.gs, OrgCore.gs, manifest and Script Properties.
2. Add `Paygroups.gs` and merge the repository changes into the existing live files. Do not replace the entire Code.gs with a stale backup.
3. Check the project's current runtime before using any syntax not supported by it. The linked project currently reports the legacy Apps Script runtime; keep backend helpers ES5-compatible unless the project is deliberately upgraded and regression-tested.
4. Add the three routes from this guide and the site/member/event/report integration above.
5. Deploy a new version of the existing Web App deployment, retaining its original URL, access settings and execution identity.
6. Test with synthetic members, sites and paygroups. Verify that a User cannot read or assign another Cooperative/BP's Paygroups.
7. Test Time In with multiple operation codes, a Paygroup with no codes, Time Out inheritance, offline queue/reconnect, duplicate prevention, Attendance Logs, sheet writes and a second authorized device.

**Important:** GitHub Pages and the spreadsheet header updates do not deploy the private Apps Script receiver. Do not use this module for payroll until the private backend changes are saved, deployed and end-to-end tests pass.
