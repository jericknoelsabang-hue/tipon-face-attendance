# TIPON Face Attendance v5.5.9 — rollout and testing

This version updates the existing **GitHub Pages** frontend and requires a **matching Google Apps Script Web App** backend update for central database changes. GitHub Pages alone cannot modify Google Sheets or publish Apps Script.

## Features

- **Admin Work locations list**: list all approved work locations, search, add, edit, delete and refresh. Add remotely by clicking or dragging a point on an OpenStreetMap / Leaflet map. Latitude and longitude populate automatically. An explicit location search helps find distant places. Manual coordinates remain available if the map cannot load. The Admin form does not use current GPS.
- **Cooperative dropdowns**: all approved MPC names are selectable by Administrators where appropriate. Regular Users remain limited to their assigned MPC/BP for security.
- **Attendance Logs**: Username heading; MPC, BP, Work location and existing attendance columns remain visible. New backend writes the verified username on new events, and resolves historical account IDs if those accounts still exist.
- **Work location safety**: an open Time In blocks changes to site GPS, radius, MPC and BP, but name/address-only edits can proceed. Worksites with assigned members cannot change MPC/BP until reassigned.
- **Face enrollment**: adaptive eye-blink calibration, faster liveness sampling, guidance for slow blink and three distinct descriptors; existing biometric/consent requirements are retained.
- **Dashboard**: From date and To date inclusive range, MPC selector and Reset filters.
- **Member List / Attendance Logs**: new Refresh buttons explicitly request central synchronization.

## Deploy the backend

Obtain the **TIPON_Backend_v5_5_9_Admin_Map_Usernames.zip** package supplied with the corresponding ChatGPT response. It contains `Code.gs`, `OrgCore.gs`, `SETUP_README.txt`, and `TEST_RESULTS.txt`.

1. Open the existing TIPON Organization Attendance spreadsheet > **Extensions > Apps Script**.
2. Back up the existing `Code.gs` and `OrgCore.gs`.
3. Replace both complete files with the v5.5.9 versions. **Do not overwrite the manifest, Script Properties, encryption keys, or spreadsheet data**.
4. Choose **Deploy > Manage deployments**, edit the existing Web App deployment, choose **New version**, and **Deploy**. Keep the same `/exec` URL.
5. Open [the application updater](https://jericknoelsabang-hue.github.io/tipon-face-attendance/update.html) to update the offline shell.
6. Test Admin Member Edit, Admin Add work location, Member Refresh, Username column and Face enrollment at an approved site. Test a second approved device to verify synchronization.

**Important:** Do not clear local storage or delete Google Sheet rows while attendance entries are queued for synchronization.

## Remaining live checks

Static source checks, mocked authorization/site-update rules, map click coordinate binding, blink state machine and dashboard range tests passed. These tests do not replace **live Apps Script deployment verification, cross-device syncing, camera/GPS testing, or payroll/security review**. Offline AI and browser-based blink checks are not fraud-proof biometric security.
