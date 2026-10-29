# TIPON 5.5.36 repair

## Concrete defects fixed

- Removed the obsolete duplicate `editAttendanceFromLog` declaration which replaced the audited, server-backed Edit flow.
- Corrected `ids.map(getOne)` to read each correction event from the `punches` store; previously the event ID was incorrectly used as a store name.
- Refresh Attendance Logs after automatic polling and reread the ledger once with a new account-scoped cursor namespace. A server-confirmed event clears an obsolete local rejection marker. No IndexedDB stores or source sheet rows are cleared by this release.
- Added the missing authenticated `memberTransferLocations`, `memberTransferUpdateV2`, and `memberFaceUpdateV2` receiver routes. Transfers authorize against the original member scope, validate every target site and revision, preserve templates, block open-session moves, and write an audit entry. Face updates require an approved in-scope enrollment User, consent, an encrypted template, and a matching revision.
- Keep the current live camera descriptor fresh before each manual enrollment capture; reject stale captures. Show Capture Sample 1/2/3 of 3. Retain randomized blink/head-turn verification with a 45-second challenge window and clearer slow-blink guidance. These checks are not certified presentation attack detection.
- Stop the terminal camera before enrollment; rearm recognition after a failed GPS/punch attempt so a fresh live challenge can retry.
- Remove the duplicate Full Screen click listener which could immediately undo the camera module's toggle.
- Reset inherited chevron padding so Assigned Work Location uses a compact arrow. Preserve equal-height controls, editable Cooperative/BP selections, required location validation and accessible error focus.
- Add Member Review, showing enrollment and outstanding synchronization issues.
- Reuse validated decrypted templates in memory between polls; invalidate on face key/template changes. Raw descriptors are not added to the synchronization payload or persisted by this cache.

## Validation

Run `node --test tests/regression.cjs`. Six tests cover roles, attendance sequencing, correction submission against the proper store, authorized transfers and rejection cases, face-update validation/audit, and duplicate handler prevention. All frontend JavaScript files and the composed private receiver passed Node syntax checks; `git diff --check` passed.

The live login-page System Status check returned Connected to TIPON KABILANG before backend editing. The existing Apps Script deployment was updated in place from version 18, retaining its URL and access settings. Final deployment confirmation and signed-in UI tests must be verified after the browser connection is available. The public source is kept free of the private receiver's administrator seed, credentials, face templates, and attendance data.

## Remaining live acceptance checks

Use an approved User account: confirm Dashboard is hidden; view/reset/refresh/paginate logs; open member Edit and Review; verify matching required work locations; capture three live samples and save centrally. At a configured site, use a real device camera/GPS for Time In, then Time Out after the 90-second duplicate-protection interval. Confirm the same session on a second authorized device. Test corrections and deletion with designated disposable records. No real attendance was fabricated or deleted during these checks.

## Backend integration / rollback

`backend-patch/MemberFaceTransfer.gs` contains only the new helpers. When installing manually, add them once at global scope and dispatch the three action names after `tp5Auth_`; lock both update routes with `tp5Lock_`. They were appended to the existing private Code.gs for this repair; do not add a second copy. Rollback uses the previous GitHub commit and the existing Apps Script deployment's version 18. Do not initialize a new organization or clear browser/site data.
