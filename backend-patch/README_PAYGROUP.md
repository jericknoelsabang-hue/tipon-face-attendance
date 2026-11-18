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
paygroups: tp5PGRead_().filter(function(pg){return actor.role==='admin'||(actor.coop===pg.coop&&TIPONOrgCore.platformKey(actor.platform)===TIPONOrgCore.platformKey(pg.platform));}),
paygroupDirectorySupported: true,
```

Do not expose all paygroups to User accounts. The authenticated User receives only their approved Cooperative + Business Platform scope.

## Required record integration before payroll use

The new directory endpoints alone are not enough to make attendance payroll-ready. The live receiver must also be updated to:

1. Persist `paygroupIds` on member and Work Location records, include them in the catalog, and validate that each member assignment is a subset of Paygroups assigned to the member's selected Work Locations.
2. Persist `paygroupId`, `paygroup`, and `operationCode` on each Time In event. Time Out must inherit the Time In session's Paygroup and must not request an Operation Code.
3. Validate Time In operation codes server-side against the selected Paygroup's configured `operationCodes`. A blank operation code is valid only when that Paygroup has no operation codes.
4. Preserve the three fields when events are projected into attendance sessions and when Attendance Logs are corrected or exported.
5. Add columns to the existing report writer: Paygroup and Operation Code. Do not reorder or remove the existing first eight columns in `TIPON Attendance v5`. Append the new columns after BP. Add Paygroup to `TIPON Members` and include the field in the member import/export mapping.
6. Keep Admin-only directory mutations server-authorized. User may view and assign Paygroups only within their own MPC/BP and cannot add, edit, or delete the directory.

## Deployment and QA

1. Back up current Code.gs, OrgCore.gs, manifest and Script Properties.
2. Integrate the route and record changes into the current deployed source; do not paste an older full Code.gs backup.
3. Deploy a new version of the existing Web App deployment, retaining its original URL, access settings and execution identity.
4. Test with synthetic members, sites and paygroups. Confirm a User cannot read or assign another Cooperative/BP's Paygroups.
5. Test Time In with a Paygroup having multiple operation codes, a Paygroup with no operation codes, Time Out inheritance, offline queue/reconnect, duplicate prevention, and attendance report output.
6. Verify central receipts and a second authorized device before using the data for payroll.

**Important:** This patch file supplies directory handlers and deletion safeguards. It is not a replacement for integrating the record-level validation and event/report fields above. Do not use for production payroll until all tests pass.
