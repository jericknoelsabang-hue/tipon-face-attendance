# Record-management QA — November 5, 2026

Scope: attendance record management, member metadata, work locations, connectivity and cached startup. Face identification, biometric enrollment, recognition accuracy and liveness are outside this review.

| Check | Evidence / result |
| --- | --- |
| Automated regression suite | 94 tests passed, including scoped reads, stale revision rejection, open-session deletion protection, offline queue preservation, retry deadlines and network fallback. |
| Private backend dependency diagnostic | Live read completed: 2 members, 2 locations and 4 raw/corrected attendance events; memberMetadataReady=true; missingDependencies=false. Counts are a point-in-time snapshot. |
| Member Edit and weekly schedules | Missing backend functions supplied by MemberMetadata.gs; synthetic authorized writes and revision checks passed. |
| Member deletion | Synthetic out-of-scope and open-session deletions rejected; completed-session soft deletion preserves attendance. |
| Work Location deletion | Rejection message and code preserved; local record restored; unconfirmed deletion stays queued. |
| Slow network | Configuration request aborts at 2.5 seconds and falls back to cached configuration. First-time setup still needs a successful online configuration download. |
| Repeated requests | Optional capability failures are probed at most once per minute per active session; failed special writes honor retry deadlines. |
| Live UI coverage | Previously verified 2 member rows and matching Attendance Logs/Sheet values after backend sync repair. Current session is signed out; live create/edit/delete button sequences and a second physical device have not been fully retested. |
| Offline operation | Automated cache and durable-queue tests pass. A full physical-device offline/reconnect scenario remains unverified. |

## Fixed findings

1. Metadata action routes referenced functions absent from the deployed project.
2. Duplicate action handlers and capability flags claimed unavailable functionality.
3. Optional capability probes added an unnecessary failing request to each sync cycle.
4. Failed special-operation retry timestamps were recorded but not honored.
5. Work Location deletion hid server rejection details and could assume a revision without a receipt.
6. Configuration startup could wait indefinitely on a stalled fetch despite a cached copy.

## Release limits

This is not a certification that every feature is production-ready or that sync is instantaneous. Sync requires the app to be open, a valid account lease/session and a reachable backend. First-time offline use needs prior online setup. No production records were created, edited or deleted solely for QA. Additional live UI and physical-device checks are required before declaring complete operational readiness.

## v5.5.103 schedule-reporting review

104 automated tests passed after adding coverage for scheduled AWOL across weekends, leave resetting the streak, grace-period lateness, active versus overdue open shifts, overnight work-date attribution, filter resets, safe review CSV, metadata-only edits during an open shift, duplicate previews/merges and retired-site scope checks. HTML IDs are unique; changed JavaScript files pass syntax checks.

Frontend reports now use the saved weekly schedule. Attendance Review includes Late and overdue No Time Out alongside provisional AWOL/absence flags, scheduled hours, Time In and late minutes, with a CSV export. Charts draw at most 60 daily values and repeated unchanged renders are reused within the same minute. These changes do not certify instant network sync or personnel findings.

Live preview found one merge candidate group and zero blockers. SiteDuplicates.gs and the updated MemberMetadata.gs were saved to the private project before browser access failed. A subsequent Code.gs change timed out and its saved state could not be confirmed. The browser then reported no connected browser. No actual duplicate merge was run; the latest confirmed backend deployment remains Version 4. The frontend push does not deploy Apps Script. Check current Code.gs, publish the compatible backend version and run the owner cleanup preview/merge before claiming live duplicate removal or the edit-guard fix is deployed. See backend-patch/README_SCHEDULE_REPORTS.md.

Live Admin/User button flows, new dashboard visual layout and two-device offline/reconnect behavior remain unverified for this release because the browser disconnected. Face identification/enrollment remain outside this review.
