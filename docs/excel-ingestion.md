# OpsView workbook ingestion

The importer extends the existing Next.js 14 App Router, NextAuth role guards,
Prisma/PostgreSQL production monitoring, SheetJS parsing, and Smart Bulk Import
review workflow. It does not create a second campaign or performance system.

## Source preservation

`ProductionImport.originalFile` retains the exact uploaded bytes. The SHA-256
file hash identifies that archive. Original sources are accessible only to the
uploader and CEO through the authenticated download endpoint. An encrypted source
remains `PASSWORD_REQUIRED` until its uploader supplies the authorized password
inside OpsView. Unlocking resumes extraction in the same batch. The original
encrypted archive is never overwritten. The legacy `parentImportId` API remains
compatible with previously uploaded decrypted copies.

## Password unlock

The dedicated `POST /api/production-monitoring/smart-import/:id/unlock` endpoint
accepts a JSON password over HTTPS, requires the uploader's authenticated session,
and rejects cross-origin requests. Even a CEO cannot unlock another uploader's
workbook. Source download retains the established uploader/CEO audit permission.

Supported file encryption is XLSX Agile AES-128/AES-256 CBC with supported SHA
profiles, or Standard AES-128/SHA-1. Legacy encrypted XLS and other encryption
profiles return `UNSUPPORTED_ENCRYPTION`. Worksheet protection and passwords to
modify a workbook do not trigger file unlock. The implementation uses
[officecrypto-tool](https://github.com/zurmokeeper/officecrypto-tool) in an isolated
Node worker and checks Agile package HMAC integrity before extraction.

Passwords are transient request/worker data, never stored in database rows,
URLs, import history or logs. Decrypted workbook bytes stay in memory and are
wiped after extraction; only the existing structured source rows are persisted.
JavaScript strings cannot be reliably overwritten; references and UI input are
cleared as far as the runtime permits. No decrypted temporary file is created.
Workers have a 15-second timeout and a 128 MB old-generation heap limit.

Durable database attempts limit each file to five and each uploader to fifteen
requests per ten minutes. Advisory locks prevent concurrent attempt races;
duplicate active requests are rejected. A 330-second lease permits recovery from
an interrupted process. Cancellation preserves the encrypted audit source.
The UI accepts up to ten files, each with independent unlock and review state.
Extraction endpoints allow up to 300 seconds, consistent with
[Vercel function duration limits](https://vercel.com/docs/functions/configuring-functions/duration).
Large sources use compressed structured rows with exact implicit-blank recovery,
bulk insertion and chunked source reconciliation. Canonical hashes retain the
previous byte format but stream row by row. Immediate post-extraction review
reuses the just-verified source report; subsequent previews and commits verify
stored source again. Original Excel dimension declarations remain in metadata;
the extracted grid covers actual serialized cells, XML cells and merge extents,
so formatting-only dimensions do not inflate the grid to thousands of columns.

Access, extraction and business stages are reported separately, with safe audit
events. Locked workbook counts display Pending rather than zero. Successful
unlock/extraction still requires mapping, validation and explicit confirmation
before business records are committed. This feature reuses existing database
models and needs no additional migration.

Extraction includes every discovered sheet in original order, hidden/very hidden
state, dimensions, coordinates, title/header/detail/blank rows, unknown columns,
cell types, formats, formula expressions, available cached results, error codes,
comments/hyperlinks supported by SheetJS, merges and workbook metadata. The
original file retains everything the structured parser cannot represent.

OOXML ZIP entries are validated for directory bounds, duplicate/path traversal
names, expansion limits, supported compression and CRC. An independent census
of worksheet XML coordinates ensures lexical source cell XML is retained even
when a cell has a missing formula cache. Raw Excel date serials remain numeric;
the workbook date system is stored separately and used during normalization.
Slash dates with ambiguous day/month ordering require review.

Feature inventory distinguishes structured cells from archive-only tables,
charts, drawings, media, pivot definitions, comments and other package parts.
Macros and external connections are listed as requiring special handling. No
macro, formula, hyperlink, or external connection is executed. Formula caches
are preserved as unverified cached source values, never described as refreshed.

Raw rows retain blank cell coordinates throughout bounded worksheet rectangles.
JSONB may reorder object keys: canonical content digests ignore key order but
include values, formulas, formats, coordinates and metadata. Reconciliation
checks row counts, dimensions, coordinates, sheet membership, nonempty-cell
counts, canonical content digests and normalized-row traceability. Commit is
blocked if either raw preservation or stored preview integrity fails.

## Structure and mapping

Extracted Excel Preview is available immediately after successful extraction,
even when no campaign/KPI table is detected. It reads owner-authorized saved
source rows through the existing paginated API, supports all sheets (including
hidden sheets), 50-row pages, row jumps, 25-column windows, cached display values
and formula expressions. Selecting a source header also selects that sheet for
mapping; applying mappings/revalidation is still an explicit action. The business
preview describes unmapped records separately from empty search results.

Recognizable campaign headers are detected anywhere in a worksheet, including
below report titles and within merged header bands. Repeated/reordered headers
create independent vertical operational regions with stable region IDs. Titles
and wholly supporting sheets are accounted for as supplemental regions. Each
region can have its own mappings. An explicit manual header override switches
that sheet to the reviewed manual mapping. Unknown columns remain available
through source-row inspection and record extensions. Headerless status columns
containing only recognized source statuses suggest `sourceRemarks`; original
strings and coordinates remain unchanged.

New KPI configurations default to direct source figures and
`calculationRules: null`, displayed as `NOT_CONFIGURED`. Approving a KPI's unit
does not enable a calculation. Reviewers must separately configure weekly
semantics, goal ratios, and additive run-rate projections. Cumulative snapshots
are not summed; percentages/rates/scores cannot use SUM. Source MTD, achievement,
and run-rate always take precedence over calculated comparisons. Missing figures
stay unavailable. Stored configurations remain authoritative. The migration
retains the existing reviewed configuration behavior through explicit rules.

Campaign/KPI/month collisions remain visible for review. Raw rows, including
both RBSC source rows, remain separate. Users explicitly select which competing
snapshot supplies the current monthly record; other rows remain in history.
Identical files use both the file hash and source fingerprint plus business key
to prevent replaying already committed figures over a later correction. File
and business-key advisory locks serialize concurrent commits. A changed workbook
retains its own archive, preview differences and field audit. Older dates remain
history-only; unavailable incoming fields preserve current valid values.

Templates are immutable, numbered versions owned by their creator. Applying a
template requires a matching sheet/header/region signature and fresh campaign
permission validation. Templates do not carry previous reporting periods,
conflict decisions, or KPI approvals into the next import.

## Pipeline and recovery

An original archive is saved before parsing. Raw rows and their first
reconciliation are persisted transactionally. Mapping review produces the
normalized preview; a separate commit transaction writes production, KPI
configuration, remembered aliases and field audit. Unexpected failures roll back
all those writes while leaving the archive/raw rows available. Stale previews
require revalidation. Repeating confirmation of an already finalized batch
returns its original result.

The UI distinguishes `VERIFIED` raw preservation from business status. Selecting
only some records produces `PARTIALLY_IMPORTED`, rather than complete success.
All unselected, rejected and historical rows remain recoverable. JSON reports
contain inspection, reconciliation, source-linked records and results; issue CSV
exports escape formula-like text.

Current production reuses `ProductionMonitoring`, so existing reporting modules
continue using the established data model. Its list API exposes source file,
sheet, row, batch and source/calculated figures. Each KPI field also retains its
original cell provenance; a value retained from an earlier import keeps that
earlier batch and cell reference. Clicking a Production Monitoring KPI opens its
source details; the page also filters by import batch, data source and as-of date.
Existing dashboard integrations
continue to use campaign metric rules; unconfigured rate aggregation is not
averaged automatically.

## API

All routes below require an import-enabled authenticated user. Source data is
restricted to its uploader or CEO; production writes additionally require access
to each selected campaign. Writes reject cross-origin requests.

| Method and route | Behavior |
| --- | --- |
| `POST /api/production-monitoring/smart-import` | Multipart `file`, optional `parentImportId` for authorized decrypted-source resume |
| `GET /api/production-monitoring/smart-import?page=1` | Scoped, paginated import history |
| `GET /api/production-monitoring/smart-import/:id` | Preview plus live raw reconciliation |
| `POST /api/production-monitoring/smart-import/:id/unlock` | Owner-only JSON password; unlock and extract the existing encrypted batch |
| `GET …/:id?format=source` | Authenticated original archive download, private/no-store |
| `GET …/:id?format=raw&sheet=Sheet1&row=4` | Exact raw source row |
| `GET …/:id?format=rows&sheet=Sheet1&page=1` | Raw source rows, 50 per page |
| `GET …/:id?format=report` | Downloadable JSON inspection/reconciliation/record report |
| `GET …/:id?format=errors` | Formula-safe issue CSV |
| `POST …/:id` | `review`, `commit`, `cancel`, or `template` action |
| `GET /api/production-monitoring/smart-import/templates` | Creator-scoped saved versions |
| `POST …/templates` | Save validated batch mappings as a new version using `batchId`, `name` |
| `GET /api/production-monitoring` | Existing month/year/campaign/metric filters plus `importBatchId`, `sourceType`, `asOfDate` |

## Migration and deployment

Back up the database using the established managed database backup procedure.
Apply the additive migration before starting the updated app:

```powershell
npx prisma migrate deploy
npx prisma generate
npm run build
```

This checkout has historical migrations from a `db push` workflow. Before using
`migrate deploy` against an existing database, confirm its migration baseline
and pending migration list (`npx prisma migrate status`). Do not reset, seed, or
accept data loss. If the deployment's migrations are not baselined, the database
operator must baseline the already-existing historical migrations, then apply
`20261014000000_workbook_preservation`. Do not blindly rerun older catalog or
data migrations. The new migration adds two batch columns, field-level production provenance, a parent-source FK
and index, explicit KPI calculation rules, and the versioned template table.

Production migration `20261014000000_workbook_preservation` was applied on October 14, 2026 after a local before-backup. Existing production/import/raw-row records were compared against the backup and preserved. The release is published through the connected GitHub main branch and Vercel deployment workflow.

## Verification

```powershell
npm test
npx tsc --noEmit
npm run lint
npx prisma validate
npm run build:smart-import:test
npm run test:smart-import:db
npx playwright install chromium
npm run test:smart-import:e2e
npm run verify:workbook
npm run verify:workbook -- 'C:\reports\AUGUST PROD(1).xlsx' 'C:\reports\august-extraction-report.json'
```

Database and browser commands create a uniquely named
`opsview_smart_import_test_*` schema, apply the actual additive migration to the
previous schema shape, and remove only that isolated schema afterward. They do
not import customer data into the application schema. Browser tests use a
isolated production build in `.next-import-test` at port 3197, leaving a running
development server's `.next` directory available. Normal releases use `npm run build`.
Do not regenerate Prisma while database/server
tests hold its Windows native engine DLL open; run build and DB suites in
sequence.

The verification CLI reports extraction/JSON round-trip only, not database
persistence. To verify actual persistence, upload the real workbook through the
UI and download its reconciliation report. Verify all 31 August source records,
17 columns, exact Q values, both RBSC records and P14/L32/M32/L34/M34 error cells.
Confirm source, extracted and persisted nonempty-cell counts on the actual file.
For September, verify `PASSWORD_REQUIRED`, enter the authorized workbook password
inside OpsView, inspect every sheet and region, confirm its own mappings/KPIs/periods, then
reconcile its actual committed data. Never reuse August fixture counts as proof
of real September or August ingestion.

## Limits and remaining work

- The September workbook in the user's Downloads was verified using an authorized
  password entered in a local hidden-input prompt: 22 sheets, 104,488 raw rows,
  786,133 source and stored nonempty cells; exact encrypted archive retained.
  The full isolated unlock/extraction/review test completed in 131 seconds with
  peak RSS about 1.2 GB, zero business writes, and scratch-schema cleanup.
  This workbook needs manual campaign/KPI mapping; extraction does not establish
  automatic business normalization. The actual August workbook remains unverified.
  Tests exercise real Agile/Standard encryption and decryption,
  including an independent msoffcrypto fixture, but do not establish the actual
  automatic conversion of arbitrary business layouts.
- Files are limited to 10 MB, 50 MB actual ZIP expansion, 10,000 ZIP entries,
  100,000 rows/1,000 columns per sheet, 4,000,000 total grid cells and 1,200,000
  serialized XML cells. Files
  beyond these limits are rejected, never truncated. Processing and preview
  memory are bounded but not streaming or a background-job service.
- Side-by-side tables sharing source rows, arbitrarily nested multirow headers,
  free-form KPI matrices and unsupported Excel structures require manual review.
  Vertical regions and common merged headers are normalized; ambiguous regions
  are preserved and blocked rather than guessed. A universal conversion of every
  possible future layout is not claimed.
- Excel tables, chart/pivot/image visuals, VBA, connections and unrecognized
  objects are retained in the original archive, not converted into business
  records. Legacy XLS feature enumeration is limited and disclosed.
- Existing persisted KPI configurations remain authoritative. Editing their
  rules requires the established configuration administration workflow; this
  importer creates reviewed configurations for new campaign/KPI combinations.
- Recovery includes atomic rollback on failure, raw/source retention, historical
  snapshots, and field change audit. An automated post-commit undo screen is not
  implemented. An operator can recover from archived sources/audits using a
  reviewed compensating operation; no silent historical replacement is allowed.
- OpsView currently has user/campaign authorization, not a separate tenant model.
  No artificial tenant architecture was introduced. Multi-tenant deployment
  requires an explicit tenant model and storage partitioning first.
- The existing dependency graph includes security advisories. This change adds
  archive/resource checks but does not constitute a dependency-security overhaul.
  Plan a supported Next.js/SheetJS dependency upgrade separately, with regression
  checks on existing workbook-specific importers.

Recommended follow-ups: background workers and object storage for larger files,
region adapters for actual unfamiliar customer workbooks, configured weighted
KPI calculations with explicit denominators, and reviewed post-commit recovery.
