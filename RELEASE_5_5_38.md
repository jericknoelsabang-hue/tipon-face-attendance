# TIPON Face Attendance 5.5.38

## Included

- Bumped all application asset URLs and the service-worker shell to 5.5.38 so browsers can stop serving stale 5.5.37 HTML, scripts, and styles.
- Tightened pagination layout for Member List, Attendance Logs, and Work Locations so counts, page indicators, and Previous/Next controls wrap instead of overlapping.
- Refreshes the authoritative Business Platform list after sign-in when online; the local directory remains available offline.
- Reduces the Tiny Face Detector input size to 256 for faster detection on ordinary kiosk hardware while keeping face-descriptor matching, live blink/head-turn verification, and assigned-site GPS checks.
- Adds a throttled spoken "Face Not Recognized" prompt instead of repeatedly speaking on every camera frame.
- Member metadata edits and face re-enrollment now fall back to the existing authenticated `submit` operation when a newer specialized Apps Script action is not deployed. The fallback requires an explicit operation acknowledgement and revision receipt; it does not assume that a local save is a central save.
- Adds regression checks for cache-version alignment, required Assigned Work Location, and pagination CSS.

## Backend-dependent capabilities

The following still require the matching private Google Apps Script backend patches to be installed and deployed: cross-cooperative/business-platform transfers requiring the global Work Location catalog, location-only updates for members without a face template, and audited attendance corrections/deletions. The GitHub Pages deployment cannot publish the separate Apps Script Web App by itself.

## Validation

JavaScript syntax and release-file consistency are checked in the repository workflow. Camera, GPS, cross-device event reconciliation, and offline-to-online synchronization must still be exercised on real devices before payroll use.
