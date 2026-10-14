# Excel ingestion implementation report

Implemented on October 14, 2026 in the existing OpsView checkout. Production
records and customer archives were not changed or imported during development.
The production migration was applied on October 14, 2026 after a before-backup. Release deployment uses the connected GitHub main branch and Vercel workflow.

## Result

Smart Bulk Import now retains encrypted sources, unlocks supported encrypted XLSX
inside OpsView in the existing batch, inventories workbook objects, discovers independent vertical
regions, supports region mappings and immutable saved mapping versions, checks
canonical source and preview integrity, and blocks incomplete preservation.
New KPIs preserve source values until calculation rules are explicitly reviewed.
Replay protection prevents an older identical upload from undoing a correction.
Partial business imports are explicitly labeled. Field provenance survives
retained-value updates and is inspectable from Production Monitoring KPI values.
Source type, batch and as-of date filters are available in that dashboard.

Existing raw-row, import, campaign, KPI, production and audit models are reused.
Original workbook bytes and unsupported objects remain recoverable. Formula
caches are not recalculated or represented as freshly verified Excel results.

## Created files

| File | Purpose |
| --- | --- |
| `lib/smart-import/archive.ts` | OLE/BIFF encryption detection; bounded ZIP/CRC inspection; archive feature inventory |
| `lib/smart-import/discovery.ts` | Header/region discovery, merged header handling, independent OOXML census and canonical hashing |
| `lib/smart-import/reconciliation.ts` | Persisted source/content/coordinate/row/traceability reconciliation |
| `lib/smart-import/templates.ts` | Creator-owned immutable layout template versions |
| `lib/smart-import/encryption.ts`, `decryption.ts`, `unlock.ts` | Supported encryption inspection, isolated in-memory decryption, owner authorization, durable rate limits and recovery |
| `lib/smart-import/encryption.test.ts`, `test-fixtures/` | Real encryption tests and independent MIT-licensed msoffcrypto reference fixture |
| `components/production-monitoring/encrypted-workbook-unlock.tsx` | Password/show-hide/error/cancel/progress controls |
| `app/api/production-monitoring/smart-import/[id]/unlock/route.ts` | Bounded owner-only unlock request |
| `scripts/build-smart-import-test.cjs` | Production test build isolated from the running development server |
| `lib/smart-import/fixtures.ts` | Labeled synthetic August and encrypted-container fixtures |
| `lib/smart-import/workbook-preservation.test.ts` | Workbook preservation and edge-case regressions |
| `components/production-monitoring/workbook-audit-panel.tsx` | Reconciliation, encryption resume, inventory, regions and templates UI |
| `components/production-monitoring/source-value.tsx` | KPI source-value inspection dialog |
| `app/api/production-monitoring/smart-import/templates/route.ts` | Template listing and version creation APIs |
| `prisma/migrations/20261014000000_workbook_preservation/migration.sql` | Additive schema changes and legacy calculation-rule preservation |
| `playwright.config.ts` | Isolated production-server browser test configuration |
| `e2e/smart-import.spec.ts` | Browser/API security, upload, review, commit, provenance, replay and encrypted-resume tests |
| `scripts/verify-workbook.cjs` | Real-file or synthetic-fixture extraction verification CLI |
| `docs/excel-ingestion.md` | Technical, deployment, fixture verification and limitations documentation |
| `docs/excel-ingestion-implementation-report.md` | This report |

## Modified files

- `lib/smart-import/parser.ts`, `types.ts`, `headers.ts`, `normalization.ts`:
  source metadata, archive scope, period/date handling, remarks mapping, region
  and reconciliation types.
- `lib/smart-import/engine.ts`, `calculation.ts`, `review.ts`: independent region
  mapping, safe source figures, reviewed semantics and validation.
- `lib/smart-import/service.ts`, `api.ts`: archive-first retention, parent-source
  access, transactions, replay prevention, checksums, accurate partial status,
  provenance and confidential-error handling.
- `lib/smart-import/smart-import.test.ts`, `persistence.test.ts`: updated explicit
  period expectations and expanded database regressions.
- `components/production-monitoring/smart-import-wizard.tsx`: audit UI integration,
  approved calculation controls, source inspection and accurate completion state.
- `app/api/production-monitoring/smart-import/route.ts`,
  `smart-import/[id]/route.ts`: encrypted-source resume, reports, raw pagination
  and template application.
- `app/api/production-monitoring/route.ts`, `app/production-monitoring/page.tsx`,
  `types/production-monitoring.ts`: source-aware filters and provenance display;
  unconfigured rate aggregation remains unavailable.
- `prisma/schema.prisma`: additive storage model changes.
- `scripts/test-smart-import-db.cjs`: apply the real migration to an isolated
  prior schema shape, run database or browser tests, safely clean only that schema.
- `package.json`, `package-lock.json`: Playwright test dependency and verification
  commands; `.gitignore`: browser output exclusions; `README.md`: updated setup.

## APIs and database migration

The existing staged import endpoints remain compatible. Added template GET/POST
endpoints, `parentImportId` multipart resume, `template` action, `format=report`,
`format=rows`, and production `importBatchId`, `sourceType`, `asOfDate` filters.
Source/preview/commit/report access uses existing role and campaign guards.

The new migration adds `ProductionImport.parentImportId` and `reconciliation`,
the parent FK/index, `ProductionMonitoring.sourceProvenance`,
`CampaignMetricConfig.calculationRules`, and `ImportMappingTemplate` with
creator/name/version uniqueness and creator/history indexing. It preserves
existing reviewed calculation behavior while new configurations default to
unconfigured rules. No existing table/column or historical record is dropped.

See `excel-ingestion.md` for migration baselining, deployment and recovery steps.

## Validation

Final command results are recorded below after execution:

| Check | Result |
| --- | --- |
| Unit suite (`npm test`) | 164 passed; database-only cases run separately |
| Type check (`npx tsc --noEmit`) | Passed |
| Lint (`npm run lint`) | Passed |
| Prisma validation | Passed |
| Production build | Passed |
| Isolated PostgreSQL suite | 18 passed; actual additive migration applied in scratch schema |
| Production-build Chromium suite | 5 passed: password unlock, independent multi-file passwords, explicit commit and existing import/provenance regressions |

Database tests cover transactional rollback, stale previews, concurrent
confirmation, source retention, permissions, immutable templates, source
tampering, explicit partial imports, field provenance and correction replay.
Browser tests cover protected access, all-sheet/row inspection, source remarks,
KPI approval, real commit/reconciliation, dashboard provenance and filtering,
repeat upload, encrypted-source resume and inaccessible campaign writes.

## Reconciliation evidence

| Workbook | Verification scope | Result |
| --- | --- | --- |
| Synthetic August fixture | Extraction and isolated browser/database commit | 1 sheet, A1:Q34, row 3 headers, 17 columns, 31 detail records, 514 source and 514 persisted raw nonempty cells |
| Synthetic August error/identity tests | Raw extraction, validation and traceability | Q remarks retained; both RBSC source rows retained; P14 `#REF!` and L32/M32/L34/M34 `#DIV/0!` retained |
| Real encrypted synthetic XLSX | Password unlock, source retention and reconciliation | Agile and Standard decryption; wrong password/retry; exact encrypted original retained; 514 source cells reconciled after unlock |
| Independent public msoffcrypto fixture | Cryptographic compatibility | Decrypted bytes match upstream plaintext SHA-256 |
| Actual `AUGUST PROD(1).xlsx` | Unavailable | No actual-file reconciliation claim |
| Actual `BPI PA DASHBOARD SEPTEMBER.xlsx` | Unavailable | No actual encryption/decryption/content-ingestion claim |

The number 514 describes the synthetic fixture, not the customer's August file.
Encrypted fixtures now contain actual encrypted workbook data. Customer files must be tested using the
documented fixture-specific verification workflow when available.

## Remaining limitations and security

Common vertical regions and merged header bands are supported. Arbitrary nested
headers, side-by-side tables sharing source rows and unfamiliar KPI matrices
require manual mapping or a future adapter; raw content remains retained and
ambiguity blocks normalization. Huge files beyond configured limits are rejected
without truncation. Parsing is bounded in-process, rather than a streaming job
service. Workbook chart/pivot/image/macros/connections are archive-only or marked
for special handling. Legacy XLS object inventory is limited. There is no
post-commit undo UI. Server password decryption supports selected Agile/Standard
XLSX profiles; legacy encrypted XLS is explicitly unsupported. Atomic failure rollback, source
archives, field audit and compensating operator recovery remain available.

Uploaded formula/macros/links are not executed. Expanded archive limits, CRC,
coordinate and cell ceilings, source/preview hashes, campaign permissions,
creator/uploader source ownership, origin guards, protected downloads and
formula-safe issue exports are implemented. No passwords are stored or logged.
The existing application is scoped by users/campaigns rather than a tenant model.
Dependency installation reported 26 advisories in the full existing dependency
graph; a supported Next.js/SheetJS upgrade remains separate work. Consequently,
this report does not certify every enterprise requirement or all future workbook
layouts as production-verified.

Recommended follow-ups: verify both actual customer workbooks; apply the reviewed
migration before release; upgrade vulnerable dependencies; add adapters for any
unfamiliar layouts discovered in those files; move very large workloads to
workers/object storage; configure weighted KPI denominators and a reviewed
post-commit recovery workflow.
