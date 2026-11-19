# TIPON KABILANG — Paygroup and Operation Code backend

The GitHub Pages frontend and the private Apps Script receiver deploy separately. Keep the existing Web App deployment ID, /exec URL, execution identity, and access setting. Do not replace the live Code.gs with an older backup.

## Current integrated v5 backend

The current v5.5.114 code line contains Paygroup validators, Department and Operation Code attendance validation, and the upgradeTIPONPaygroups() schema migration. Its missing pieces are the authenticated API routes and Paygroup-aware CSV import acknowledgment.

1. Add PaygroupEndpoints.gs to the existing Apps Script project. Do not also add Paygroups.gs when Code.gs already defines tp5ValidatePaygroup_, tp5AttendancePaygroup_, and tp5PaygroupIds_; those files implement overlapping versions of the same helpers.
2. In tp5Handle_(q, transport), after var actor=tp5Auth_(q);, add:

```js
if(action==='paygroups')return tp5PGList_(actor);
if(action==='paygroupAdd')return tp5Lock_(function(){actor=tp5Auth_(q);return tp5PGAdd_(actor,q);});
if(action==='paygroupUpdate')return tp5Lock_(function(){actor=tp5Auth_(q);return tp5PGUpdate_(actor,q);});
if(action==='paygroupDelete')return tp5Lock_(function(){actor=tp5Auth_(q);return tp5PGDelete_(actor,q);});
```

3. Set paygroupDirectorySupported:typeof tp5PGList_==='function' in the catalog response. Add memberImportPaygroup to the health response; report it as available only after the importer persists and acknowledges paygroupIds.
4. Update MemberCSVImport.gs to validate each submitted paygroupIds value against the row's Cooperative and Business Platform, require each Paygroup to be assigned to a matching active Work Location, persist the IDs, and return memberImportPaygroup:true.
5. Validate member Paygroup assignments against the selected Work Locations on the server, including location-only reassignment. Keep the existing member revision checks and audit trail.
6. Run upgradeTIPONPaygroups once from the Google Sheet menu or Apps Script editor. It safely adds Department to the visible TIPON Paygroups directory and the Attendance report when their destination columns are blank, then refreshes the directory. It stops with a schema error instead of overwriting conflicting data.
7. Save the project and deploy a new version of the existing Web App deployment.

Approved Admins can add, update, and delete Paygroups. An approved User (registrar) can add, edit, and delete Paygroups only in their own Cooperative + Business Platform scope. Deletion is a soft delete and the server rejects it while any active Work Location or member still references that Paygroup. Kiosks and Users receive only the Paygroups within their authorized Work Location or account scope.

## Attendance rules

The server must validate Operation Code selections after resolving the authenticated member and GPS-matched Work Location, before writing or acknowledging an attendance event.

- A member with one eligible Paygroup records Time In directly. When multiple Paygroups are eligible and Departments are configured, the terminal asks for Department first, then shows only that Department's Operation Codes.
- Time In with configured Operation Codes requires a valid selected Paygroup, Department, and code.
- A member with no Paygroup, or with Paygroups that have no codes, can record Time In automatically with a blank code.
- Time Out ignores client-supplied selections and inherits the Paygroup, Department, and Operation Code from the matching Time In session.
- For an offline Time Out without a session ID, accept it only when exactly one open Time In can be identified.
- Store Paygroup, Department, and Operation Code on both event directions and preserve them in polling, corrections, and the attendance report.

## Legacy backend variant

For an older project that does not have the current v5 Paygroup helper functions, use Paygroups.gs and the complete compatibility steps in the archived project history. Check for duplicate global function names before adding either implementation. Never install both variants together.

## Verification before operational use

Use synthetic records and approved test accounts. Verify directory reads, scoped User creation, Admin-only update/delete, member and Work Location assignments, CSV acknowledgment, coded and uncoded Time In, Time Out inheritance, attendance sheet columns, and a second authorized device. Do not treat an Apps Script health response alone as proof that every workflow is working.
