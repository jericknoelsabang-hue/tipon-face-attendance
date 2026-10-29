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
