# TIPON 5.5.37

- Attendance Edit uses a native app dialog with Date, Time In, Time Out and Date Time Out controls. Edit/Delete no longer ask the user for a reason. Server audit entries retain the actor and action.
- Fixed blink validation rejecting fully closed eyes. Reduced the idle interval between inference frames, retained randomized blink/head-turn verification and GPS/duplicate checks, and made live instructions easier to read. This is not certified presentation attack detection.
- Member BP choices include all configured/observed platform codes and the nine existing starter codes, including ATS. Transfers validate matching central work locations.
- Member ID is editable as a validated unique business number. The internal member key remains stable for template encryption, event history and duplicate protection. Lists and attendance exports display the editable number. Member metadata/face routes persist it centrally, and Sheets projections use it without rewriting raw events.
- Three successful manual re-enrollment captures invoke one immediate save/sync. Successful acknowledgement clears stale face-review flags; capability-aware recovery retries operations rejected by an older receiver for unsupported actions.
- Standardized table headings/cells, button heights, dropdowns and pagination spacing in polish.css. User foreground polling is five seconds plus server latency; writes trigger sync immediately. Hidden/offline/signed-out clients cannot receive instantaneous updates. No WebSocket service was added.

Validation: `node --test tests/regression.cjs` passes 11 tests, including the closed-eye regression, stationary-face rejection, date/time validation, editable BP/Member ID, and automatic three-capture re-enrollment save. All frontend files and the composed private receiver pass syntax checks. Live camera/GPS acceptance remains a separate physical-device check. No production attendance was created, edited or deleted during development tests.

Private Code.gs was updated in the existing project and a new deployment was submitted under the existing URL/access settings. Public backend-patch/MemberFaceTransfer.gs contains the reusable route helpers without private credentials. The receiver also includes 5.5.37 capabilities, ATS/observed member-platform codes, display-number projection, and automatic action labels for corrections.
