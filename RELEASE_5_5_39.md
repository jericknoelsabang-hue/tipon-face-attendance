# TIPON Face Attendance 5.5.39

## Continued fixes from the interrupted Work-mode session

- Route Administrator member edits to `adminMemberUpdateV2`; keep User transfers on `memberTransferUpdateV2`.
- Support editing the business Member ID during Admin edits, User transfers and face re-enrollment. The immutable internal member key and historical attendance remain unchanged; duplicate Member IDs are rejected centrally.
- Verify the full server response (Member ID, name, Cooperative, Business Platform and Assigned Work Locations) before treating a member change as synchronized.
- Remove client-supplied enroller identity from the specialized face-update request; the backend records the authenticated actor.
- Populate Business Platform selectors from the organization directory and platforms referenced by transfer locations, members, accounts, devices and attendance records.
- Do not block a locally valid Time Out solely because the central attendance read timed out. Save it locally for synchronization/session reconciliation, while explicit authentication, disabled-account, permission and protocol errors remain blocking.
- Refresh cache-busted frontend assets to 5.5.39 and align the base stylesheet cache key. Standardize the Admin member edit dialog controls.

## Backend and deployment boundary

The matching update to `backend-patch/MemberLocationEdit.gs` and its installation guide is included. The private Google Apps Script project must still receive the patch and be redeployed through the existing Web App deployment. GitHub Pages cannot deploy the backend.

## Validation status

The regression workflow checks JavaScript syntax and the repository regression suite. A passing CI run does not replace live camera/GPS testing, second-device synchronization testing, or verification that the private Apps Script deployment is updated. Do not use for payroll until those operational checks pass.
