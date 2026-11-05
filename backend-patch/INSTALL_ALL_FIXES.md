# TIPON KABILANG v5.5.34 — Deployment status and checklist

GitHub Pages deploys the public frontend automatically. The private Google Apps Script backend is separate and must be updated in the **existing** Apps Script project.

## Current frontend

- Member List and Attendance Logs pagination.
- User lands on Face Terminal; Dashboard is Admin-only.
- Cooperative, Business Platform and Assigned Work Location are editable for an in-scope member.
- Assigned Work Location is required and its disclosure arrow is smaller.
- Face enrollment requires three manual captures after live blink/head-turn checks.
- Duplicate-face conflicts identify the existing member and keep the enrollment camera preview available; duplicate enrollment remains blocked.
- Attendance Logs has Edit, Delete and Review controls with an empty-filter explanation.
- Member enrollment and face re-enrollment are saved to a local outbox and require server acknowledgement.
- Offline changes remain queued and show sync/review status instead of claiming they are synced.

## Private backend patch

Follow [README_MEMBER_LOCATION.md](./README_MEMBER_LOCATION.md). It describes the routes and helper files for member transfers, encrypted face re-enrollment and attendance correction. It also documents the two poll/event-window changes required for cross-device correction reconciliation.

**Do not replace the entire live Code.gs with a backup.** Add the compatible helper files, check for duplicate function names, add only missing routes, and preserve Script Properties, the existing deployment ID, the /exec URL, face encryption keys and all production records.

## Deployment verification

1. Confirm the latest GitHub Pages build/deploy run is successful.
2. Install the published frontend from the [TIPON App Updater](https://jericknoelsabang-hue.github.io/tipon-face-attendance/update.html).
3. Deploy a new version of the existing Apps Script Web App.
4. Test with synthetic records and approved test accounts.
5. Verify a server ACK, a second authorized device, offline queue recovery and rejection cases before production use.

A successful GitHub Pages build does not confirm the Apps Script backend or production attendance behavior.

### Weekly Work Schedule: v5.5.85
Both Admin and User can edit a member's weekly days/start/end via Member List. A **private** `memberWorkScheduleUpdateV2` route must be added to the existing authenticated `Code.gs` and a new version of that SAME Apps Script deployment published; the frontend alone cannot make the old endpoint accept new schedule fields. Follow the dedicated steps in [README_MEMBER_LOCATION.md](./README_MEMBER_LOCATION.md). Verify central acknowledgment, refreshed member roster and member-sheet schedule columns with synthetic test accounts before operational rollout.

## v5.5.99 attendance record ownership validation

Update the existing AttendanceCorrection.gs helpers from this repository and deploy a new version of the existing Apps Script Web App. GitHub Pages cannot deploy this private backend automatically. The attendanceCorrect request now includes memberId; the backend rejects a missing or mismatched ID before editing/deleting a session. Duplicate-direction normalization also rejects sessions containing different member IDs instead of silently discarding one member's event.

The frontend validates member/session IDs before local correction writes and before synchronization, including legacy queued edits. This update does not change face identification or repair past misidentified punches.

## v5.5.101 missing backend sync dependencies

The live project inspected on November 5 contained Code.gs, OrgCore.gs, AdminBootstrap.gs and PhotoArchive.gs. Code.gs called tp5BPDetails_ and tp5ApplyAttendanceCorrections_ without their helper files. This can fail directory downloads, attendance polling and uploads that inspect the ledger.

1. Add BPDirectory.gs and AttendanceCorrection.gs from this directory to the existing private project; check for duplicate function definitions.
2. Keep tp5EventWindow_ returning tp5ApplyAttendanceCorrections_(rows). Change the full-ledger reader to `function tp5AllEvents_(){return tp5RawAttendanceEvents_();}` so correction overlays never recursively re-enter themselves.
3. Keep reports and upload session validation based on the corrected view: use `ledger=tp5ApplyAttendanceCorrections_(allLedger).filter(function(e){return !e.deleted;})` in tp5Submit_, and `TIPONOrgCore.project(tp5ApplyAttendanceCorrections_(tp5AllEvents_()).filter(function(e){return !e.deleted;}))` in rebuildTIPONReport_. The event-ID/digest lookup must still use the raw ledger.
4. After the existing authenticated `var actor=tp5Auth_(q);`, add the missing attendance route: `if(action==='attendanceCorrect')return tp5Lock_(function(){actor=tp5Auth_(q);return tp5AttendanceCorrect_(actor,q);});`
5. Save, then edit the existing Web App deployment to use a new version. Preserve its URL, execution identity and existing access settings. Frontend pushes alone do not update this private deployment.

No setup/reset, credential changes, or production record deletion is required. Face matching and biometric enrollment are outside this patch. Confirm actual upload acknowledgments and scoped reads before claiming every device is synchronized.
