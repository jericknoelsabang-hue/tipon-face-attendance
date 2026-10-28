# TIPON KABILANG — Business Platforms Backend Patch

This patch completes the Admin Business Platforms table in GitHub Pages v5.5.18 with **centrally stored BP Name and BP Abbreviation, Add, Edit, and Delete**. The frontend is already prepared to call the endpoints below, but **GitHub Pages cannot update Google Apps Script deployments**.

> **Do not put Code.gs, an Apps Script access key, account seed data, user tables, or a face encryption key in a public GitHub repository.** The included `BPDirectory.gs` is a standalone, nonsecret helper and must run *inside* the existing private Apps Script project.

## Compatibility and prerequisite

The exact integration anchors below were checked against the user's prior **TIPON_Code_v5_5_9.gs**, which had the existing `platformAdd` action and `tp5PlatformNames_()`. If your deployed Code.gs is newer or differs, **do not replace the whole project with that earlier version**. Merge these narrowly with the current source and keep its other changes.

First back up `Code.gs`, `OrgCore.gs`, the project manifest, and the existing Script Properties. Do not clear `_TP5_*` worksheets or change tokens, pepper, face keys, or gateway credentials.

## Step 1: Add one file

In the current attendance spreadsheet, open **Extensions → Apps Script**. Create `BPDirectory.gs` and paste all of `backend-patch/BPDirectory.gs` from this repository into it.

## Step 2: Integrate four action routes in Code.gs

In your *current* `tp5Handle_(q, transport)` function, change the public BP-directory read:

Before:
```js
if(action==='platforms'){tp5Must_(props.getProperty('TP5_SETUP_STATUS')==='READY','Organization setup is incomplete.','NOT_CONFIGURED');return tp5Reply_({businessPlatforms:tp5PlatformNames_()});}
```

After:
```js
if(action==='platforms'){
  tp5Must_(props.getProperty('TP5_SETUP_STATUS')==='READY','Organization setup is incomplete.','NOT_CONFIGURED');
  return tp5Reply_({
    businessPlatforms:tp5PlatformNames_(),
    businessPlatformRecords:tp5BPDetails_()
  });
}
```

Find the authenticated action block *after* `var actor=tp5Auth_(q);` and replace the existing `platformAdd` route with the following. This uses the existing authenticated administrator and document lock.

```js
if(action==='platformAdd')return tp5Lock_(function(){
  actor=tp5Auth_(q);return tp5BPAdd_(actor,q);
});
if(action==='platformUpdate')return tp5Lock_(function(){
  actor=tp5Auth_(q);return tp5BPUpdate_(actor,q);
});
if(action==='platformDelete')return tp5Lock_(function(){
  actor=tp5Auth_(q);return tp5BPDelete_(actor,q);
});
```

In the `action==='catalog'` response, add the new optional field **beside** its existing `businessPlatforms` field. Do not change member, attendance or site behavior:

```js
businessPlatformRecords: cursor===0 ? tp5BPDetails_() : [],
```

This field enables the app to display the verified abbreviation on other devices during normal sync.

## Step 3: Deploy without changing the /exec URL

1. Save the updated scripts; check for duplicate function definitions and syntax errors.
2. Choose **Deploy → Manage deployments → Edit** on the existing attendance web app.
3. Select **New version**, then **Deploy**. Keep the existing deployment ID, access settings, and same `/exec` URL.
4. Open the GitHub Pages app updater, then reload and log in as the Admin.
5. Under **Work Locations List → Business Platforms**, test adding a *new unused* BP with a name and abbreviation.
6. Verify both columns after refresh and sign-in on a second approved device.
7. Edit its abbreviation (without changing its name), confirm the update on both devices, then delete the *unused custom BP* and confirm it disappears. Do not test Delete on an assigned platform.

## API contract (authenticated unless noted)

| Action | Request fields | Expected response fields |
|---|---|---|
| `platforms` (public directory read) | `action` | `businessPlatforms`, `businessPlatformRecords` |
| `platformAdd` | `name`, `abbreviation` | `businessPlatforms`, `businessPlatformRecords`, `created` |
| `platformUpdate` | `originalName`, `name`, `abbreviation` | `businessPlatforms`, `businessPlatformRecords`, `updated` |
| `platformDelete` | `name` | `businessPlatforms`, `businessPlatformRecords`, `deleted` |
| `catalog` | `cursor` | Existing payload plus `businessPlatformRecords` on the first page |

All mutations require a current Admin token, document lock, bounded Script Properties, audit records, and a catalog version bump. Renaming a BP used by members, sites or accounts is blocked. Deleting default or referenced BPs is blocked.

## Known limitations

- The **v5.5.18 GitHub frontend alone cannot provide centrally persisted Edit/Delete or abbreviations** if this Apps Script patch has not been deployed. It will show a clear backend error instead of falsely claiming success.
- The `TP5_PLATFORM_RECORDS` Script Property stores **only** BP names and abbreviations. No biometric templates, personal data, credentials, or attendance events are stored in it.
- This patch is based on a prior backend source file, **not verified against the currently deployed Apps Script**. Review differences before installation and test using approved test records.
- Automatic Work Location sync and existing member/attendance access controls must remain unchanged.
