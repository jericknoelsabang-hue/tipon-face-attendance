# TIPON KABILANG — Business Platform Directory v5.5.19

This patch provides the central backend handlers for the Admin **Work Locations List → Business Platforms** table. The frontend (GitHub Pages) shows the approved BP names and codes immediately, but **Add / Edit / Delete cannot persist across devices until this private Google Apps Script patch is installed and redeployed.**

## What the two columns mean

| Business Platforms Name | Business Platform (existing authorization code) |
| --- | --- |
| Asiapro Construction | AP Cons |
| Asiapro Trucking System | ATS |
| Asiapro Contracting | Contracting |
| Gawa At Kalinga | GAK |
| Independent Manufactoring Group | IMG |
| Managed Services Group - North Mindanao | MSG-NM |
| Managed Services Group - Nation Wide | MSG-NW |
| Managed Services Group - South Mindanao | MSG-SM |
| Other Construction Group | OCG |

**Critical:** The right column remains the existing platform code stored in sites, members, accounts and attendance exports. The long name is additional directory metadata, not a replacement for the code. Changing only the long name does not reassign any member or terminal.

## Current backend limitations

The public GitHub repository only hosts the frontend. The actual Apps Script \`Code.gs\` and deployed \`/exec\` URL are in a separate private Apps Script project, which GitHub commits cannot deploy.

The previous TIPON v5.5.9 \`Code.gs\` contained \`platformAdd\` but **did not** include the new descriptive directory response nor authenticated \`platformUpdate\`/\`platformDelete\`. The frontend checks capabilities before sending writes, so an old backend cannot accidentally store a long full name as a new authorization code.

**Do not replace the currently deployed Code.gs with the older v5.5.9 source.** Merge these narrowly into the currently deployed private project.

## Install in your private Apps Script

1. Open the approved TIPON Organization Attendance spreadsheet, then **Extensions → Apps Script**.
2. Back up the existing \`Code.gs\`, \`OrgCore.gs\`, manifest, and Script Properties. Do not delete or regenerate any secret, token, attendance, or member table.
3. Create a new script file **BPDirectory.gs** and paste in the full contents of [BPDirectory.gs](./BPDirectory.gs).
4. Find \`function tp5Handle_(q,transport)\` in your **current** \`Code.gs\`. Locate the public \`action==='platforms'\` condition and replace its response with the following (keep the setup check):

   \`\`\`js
   if(action==='platforms'){
     tp5Must_(props.getProperty('TP5_SETUP_STATUS')==='READY',
       'Organization setup is incomplete.','NOT_CONFIGURED');
     return tp5Reply_({
       businessPlatforms:tp5PlatformNames_(),
       businessPlatformRecords:tp5BPDetails_()
     });
   }
   \`\`\`

5. After the existing authenticated \`var actor=tp5Auth_(q);\`, replace the old \`platformAdd\` route and add two new routes:

   \`\`\`js
   if(action==='platformAdd')return tp5Lock_(function(){
     actor=tp5Auth_(q);
     return tp5BPAdd_(actor,q);
   });
   if(action==='platformUpdate')return tp5Lock_(function(){
     actor=tp5Auth_(q);
     return tp5BPUpdate_(actor,q);
   });
   if(action==='platformDelete')return tp5Lock_(function(){
     actor=tp5Auth_(q);
     return tp5BPDelete_(actor,q);
   });
   \`\`\`

6. In the \`action==='catalog'\` response, add another field next to the existing \`businessPlatforms\` field. Preserve everything else:

   \`\`\`js
   businessPlatformRecords: cursor===0 ? tp5BPDetails_() : [],
   \`\`\`

7. Save. Verify no duplicate helper names, missing hooks, or syntax errors. Choose **Deploy → Manage deployments → Edit** for the **existing** deployment, choose **New version**, then **Deploy**. Keep its approved access configuration and the original \`/exec\` deployment URL.

## Verify using test records

1. Open https://jericknoelsabang-hue.github.io/tipon-face-attendance/update.html and refresh the app.
2. Sign in with an **approved Admin** account. Open **Work Locations List → Business Platforms**.
3. Confirm that the nine long BP names display alongside their existing codes.
4. Edit a **full name only** (for example, the full name for IMG); save and confirm it persists after full reload and on another authorized device. The IMG code must remain unchanged.
5. Add a new test Business Platform Name with a unique code; verify it appears on a second device and in the Work Location dropdown.
6. Edit both fields for the **unused, nondefault test platform**, verify that code changes do not create duplicate entries.
7. Delete that **unused, nondefault test platform**, and verify it disappears centrally after refresh.
8. Attempt to delete an assigned platform. The app/backend must block this safely without deleting the associated members, sites, or attendance history.

## Server-side safety

- All mutations are behind existing **Admin authentication** and the Apps Script document lock, with audit and catalog version updates.
- A default platform code (AP Cons, Contracting, GAK, IMG, MSG-NM, MSG-NW, MSG-SM, OCG) **cannot be changed or deleted**, because older devices and role assignments may still use it. Its descriptive name **can** be edited.
- Deleting or changing the identifier of a platform assigned to any member, account or Work Location is blocked until it has been explicitly reassigned.
- Unused **custom** platforms can have both fields edited or be deleted.
- This patch stores only BP descriptive metadata in \`TP5_PLATFORM_RECORDS\`; it does not touch biometric templates, personal information, passwords, attendance ledger data, or active login tokens.
- Old App Script deployments cannot yet perform these mutations. Do not claim a save succeeded from a frontend-only edit or hide backend errors.
- The version-specific integration example uses the previous user-provided TIPON v5.5.9 \`Code.gs\`. Check against the actual deployed source before installation and verify functionality with approved test records.
