# Commercial implementation documents

These documents describe implemented commercial tenancy milestones on `codex/commercial-production`. They record the current implementation boundary, not a production rollout or a replacement for approved design specifications.

- [Commercial platform baseline](commercial-platform-baseline.md): the frozen Workstreams 1 through 6 checkpoint, verification record and Workstream 7 boundary.
- [Tenant primitives](tenant-primitives.md): organisations, sites, memberships and the first tenant fences.
- [Identity and membership](identity-and-membership.md): request-time membership, permissions, site access and AAL2 guards.
- [Customer domain conversion](customer-domain-conversion.md): commercial staff, compliance, settings, site operations and the Jan compatibility boundary.
- [Attendance tenancy](attendance-tenancy.md): organisation and occurrence-site attendance ownership, effective evidence and Jan attendance compatibility.
- [Payroll and reporting tenancy](payroll-reporting-tenancy.md): revisioned commercial payroll preparation, reporting, imports and exports, with the retained Jan payroll path.
- [Platform neutrality](platform-neutrality.md): neutral core terminology and presentation profiles.
- [Environments and releases](environments-and-releases.md): environment and release safeguards.
- [Repository protection](repository-protection.md): repository and delivery controls.

All commercial documents preserve the same constraints: inherited Jan records are not silently backfilled, production connection and deployment are separate approvals, and offline attendance remains disabled.
