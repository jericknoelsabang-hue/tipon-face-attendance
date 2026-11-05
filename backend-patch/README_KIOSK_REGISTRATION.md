# Physical Kiosk registration — new database first-worksite setup

## Verified root cause, 2026-11-05

The new **TIPON Organization Attendance** spreadsheet has a valid Administrator account but an empty `_TP5_Sites` table. The **Code.gs** function `tp5KioskLocation_` intentionally refuses Physical Kiosk registration unless the actual kiosk GPS is within **150 meters** (or the site's smaller allowed radius) of an active, approved Work Location.

The video shows a GPS reading (accuracy about 68 meters) but the server returns `GEOFENCE`. This is a missing Work Location configuration, **not a password or GPS-permission bug**.

## Resolve without compromising geofencing

1. Sign in to the updated app **as Administrator**.
2. Open **Work Locations List → Add Work Location**.
3. Enter the authorized worksite name, Cooperative, Business Platform and site address.
4. Set the **real worksite GPS pin** (drag on the map or select a verified location), and an Allowed Radius of 150 meters or less for kiosk enrollment.
5. Click **Save Location**. Confirm the central backend acknowledges the save; reopen or refresh the list to verify the site still exists. Do not write directly into the hidden `_TP5_Sites` sheet.
6. Sign out, then select **Register User / Physical Kiosk → Physical Kiosk**. At the physical worksite, click **Use current kiosk GPS**, verify accuracy 100 m or better and submit within 2 minutes.
7. The Administrator then approves the pending kiosk under **Accounts & Devices**. Test that the kiosk is restricted to its assigned GPS worksite. Verify no cross-cooperative member or attendance access.

The v5.5.90 frontend now gives actionable instructions when the existing server returns `GEOFENCE` and prevents submitting a kiosk account with stale/manual GPS coordinates. **No Apps Script backend deployment is required solely for these frontend diagnostics.** The backend still requires an authorized site record before a kiosk can register.

## Optional private Apps Script clarification

In the existing `Code.gs` function `tp5KioskLocation_`, after loading `sites`, add this check **without changing the geofence requirement**:

```javascript
tp5Must_(sites.length > 0,
  'No Work Locations are configured in the new database. Administrator: open Work Locations List and add the approved kiosk worksite first.',
  'KIOSK_SETUP_REQUIRED');
```

Then keep the original nearby-distance verification and change its error message to:

```javascript
tp5Must_(nearby.length>0,
  'Kiosk GPS is outside approved work locations. Capture GPS at the physical worksite within 150 meters of its saved location pin.',
  'GEOFENCE');
```

If applying these server changes, use **Deploy → Manage deployments → Edit → New version → Deploy** for the same existing Apps Script deployment. Never make `tp5KioskLocation_` accept an unregistered site merely to bypass the error. Register and activate kiosks only after authorization.
