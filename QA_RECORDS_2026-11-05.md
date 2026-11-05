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
