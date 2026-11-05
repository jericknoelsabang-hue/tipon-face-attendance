# Schedule reporting and Work Location cleanup — v5.5.103

## Report rules

- Late: first Time In for a scheduled workday is after saved start plus grace; late minutes count after grace.
- No Time Out: an open or invalidly paired session is overdue only after scheduled shift end. An unscheduled session uses a 24-hour review threshold.
- AWOL: provisional review after three consecutive completed scheduled workdays without recorded attendance. Rest days are skipped; approved leave/excused days reset the streak. Unscheduled days and future/uncompleted shifts do not generate absences.
- Overnight shifts crossing midnight use the previous scheduled workday when the Time In falls within that shift.
- Current roster and saved weekly schedules are used; effective-dated historical assignment/schedule versions are unavailable. Flags require human verification after synchronization and are not employment decisions.
- Filters start blank on sign-in. Reset clears DOM inputs before propagating the shared filter. Charts draw only the latest 60 daily rows; totals, review pagination and CSV cover the full selected period. Unchanged report inputs are reused within a minute to avoid repeated redraws during polling.

## Backend deployment

Update MemberMetadata.gs if that is installed. If the project instead uses MemberLocationEdit.gs, update that file; never install both because they share function names. Name, member number and schedule edits no longer require closing a shift when the Cooperative/BP and location IDs are unchanged. Scope/location changes still require Time Out.

Add SiteDuplicates.gs once to the existing private project. Under the existing locked submit route, after tp5ValidateEntity_ returns a site record and before writing it, run `if(op.type==='sites'&&!record.deleted)tp5AssertUniqueWorkLocation_(record);`.

For queued attendance to a retired duplicate, replace the active-site lookup with `site=tp5AttendanceSite_(sites,raw.siteId)`. Validate member assignment against `site._canonicalSiteId||site.id`, while retaining the original site ID, geofence, raw payload and digest in the event. Keep all other authentication, scope, GPS, clock and existing attendance validation. This accepts only a server-marked merge alias matching the canonical location's name, scope, radius and 50-metre proximity.

Save, run read-only diagnostics and publish a new version on the existing Web App deployment. Only then run the owner editor function previewTIPONDuplicateWorkLocations. If the preview is correct, run mergeTIPONDuplicateWorkLocations. It requires the existing owner/editor authorization and exposes no new public API route.

## Duplicate criteria and preservation

Only same normalized name, exact Cooperative, normalized Business Platform, equal radius and GPS centres within 50 metres are merge candidates. Different scopes or distant locations stay separate. The canonical record prioritizes existing kiosk references, member usage and creation order. Affected members keep their immutable IDs; assignments are redirected and revisions incremented. Duplicates are soft-deleted with mergedIntoSiteId. Raw attendance history stays unchanged. Open sessions or kiosk references on a record to retire block that group. The operation is idempotent and bumps the shared catalog version. It does not rewrite another device's offline queue.

## Live status at last check

The owner preview found one duplicate group with no blockers. Browser access timed out during a subsequent Code.gs edit. The new helper and member-metadata source edits were saved earlier, but the final Code.gs save/deployment and actual merge must be checked before claiming live cleanup completed. No duplicate cleanup mutation was executed at that point.
