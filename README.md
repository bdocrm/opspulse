# OpsView 360

**Operational Performance Intelligence Dashboard**  
Developed by Business Dev Team

---

## Tech Stack

| Layer      | Technology                      |
| ---------- | ------------------------------- |
| Framework  | Next.js 14 (App Router)         |
| Language   | TypeScript                      |
| Styling    | TailwindCSS + ShadCN UI         |
| Charts     | Recharts                        |
| ORM        | Prisma                          |
| Database   | Supabase PostgreSQL              |
| Auth       | NextAuth (Credentials + Roles)  |
| Deployment | Vercel                          |

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
```

```env
DATABASE_URL="postgresql://postgres:<PASSWORD>@<HOST>:5432/opsview"
NEXTAUTH_SECRET="generate-a-random-secret"
NEXTAUTH_URL="http://localhost:3000"
```

### 3. Push database schema

```bash
npx prisma db push
```

### 4. Generate Prisma client

```bash
npx prisma generate
```

### 5. Seed the database (optional)

```bash
npx prisma db seed
```

This creates default users, campaigns, and sample daily sales data.

**Roles** (`Role` enum in Prisma):

| Role       | Description                                             |
| ---------- | ------------------------------------------------------- |
| `CEO`      | System administrator — user/campaign management, all data |
| `SMT`      | Senior Management Team — executive read access            |
| `OM`       | Operations Manager — goals, reports, imports              |
| `COLLECTOR`| Collector — data entry, imports, agent management         |
| `AGENT`    | Agent — own performance & dashboard views                 |

Role-based access is centralized in `lib/permissions.ts`, which the middleware,
API guards, and UI all share as a single source of truth.

**Default credentials:**

| Role       | Email                    | Password     |
| ---------- | ------------------------ | ------------ |
| CEO        | admin@opsview.com        | password123  |
| OM         | manager@opsview.com      | password123  |
| Agent      | john.smith@opsview.com   | password123  |
| Collector  | collector.1@opsview.com  | password123  |

### 6. Run development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Features

### Smart Bulk Import

Open **Production Monitoring → Smart Bulk Import**, or use its link on the Collector Bulk Import page. CEO, OM, and Collector users can upload Excel/CSV files; OM/Collector production writes remain limited to assigned campaigns. Raw source history is visible to the uploader and CEO.

The importer stages the original file and every worksheet row, including unknown columns, blanks, formulas, evaluated values, errors, and metadata. Nothing is written to current production until the preview is confirmed. Review sheet/header/column mappings, campaign matches, new campaign/KPI configurations, reporting periods, and competing source rows; revalidate after changing any mapping. Percent text and native Excel percentages use fractions internally (85% = 0.85); unformatted numeric percentages must already use fractions.

Current campaign/KPI/month values reuse `ProductionMonitoring`. Import history extends `ProductionImport`, with complete source rows in `ProductionImportRawRow` and field changes in `ProductionMonitoringAudit`. New campaign-specific KPI rules live in `CampaignMetricConfig`; stored configurations take precedence over suggestions. Confirmed campaign aliases and KPI rules are remembered. Choose a primary KPI when a campaign has several KPIs; percentages/rates are never added to campaign production totals.

Older reporting dates are saved as historical snapshots. Blank/pending updates preserve existing valid values. Explicit zero remains zero. Re-imports skip identical data, stale previews require revalidation, and repeated confirmations of a batch do not write twice. A transaction failure rolls back all production/config/audit writes while retaining staged data and the failure reason. Sources and calculated figures are stored separately; partial weeks are not treated as a complete monthly total, and weighted/custom calculations require source values when weights/formulas are unavailable.

Supported uploads: `.xlsx`, `.xls`, `.csv`, up to 10 MB. Inspection rejects files beyond 50,000 rows or 1,000 columns per sheet, 250,000 total cells, or 50 MB expanded XLSX content instead of truncating data. Macros and uploaded formulas are never executed. Original sources can be downloaded, and problematic rows can be exported as a formula-safe CSV.

Deploy the additive migration `20260929010000_smart_bulk_import` and regenerate Prisma before running the updated app. Existing campaign completion migration `20260929000000_complete_campaign_list` remains separate. No reset or seed is needed.

Validation:

```bash
npm test
npm run test:smart-import:db
```

The second command needs `DATABASE_URL` and permission to create a temporary schema. It runs real PostgreSQL tests in a unique `opsview_smart_import_test_*` schema and removes only that schema afterwards. Neon testing uses a direct connection to keep test schema settings out of the application's transaction pool.

- **Role-based access** — ADMIN, MANAGER, AGENT
- **Dashboard** — KPI cards, bar/line/pie charts, leaderboard, campaign table
- **Campaign Monitoring** — Per-campaign detail with weekly breakdown & agent drill-down
- **Agent Performance** — Leaderboard, daily trends, individual metrics
- **Dynamic KPI** — Each campaign defines its own KPI metric
- **Filters** — Daily, Weekly, Monthly, Yearly
- **CSV Export** — Server-side export to Excel/CSV
- **Dark/Light Mode** — System-aware toggle
- **Fully responsive** — Desktop sidebar → tablet collapsible → mobile drawer + bottom nav

---

## KPI Computation

| Metric          | Formula                                    |
| --------------- | ------------------------------------------ |
| MTD             | Sum of metric values for the month          |
| Achievement %   | (MTD / Monthly Goal) × 100                  |
| Working Days    | Configurable (default 22)                   |
| Days Lapsed     | Unique working days with data so far        |
| Run Rate        | (MTD / Days Lapsed) × Working Days           |
| RR Achievement  | (Run Rate / Monthly Goal) × 100              |

**Color rules:** <80% Red · 80-99% Yellow · ≥100% Green

---

## Project Structure

```
app/
├── layout.tsx              # Root layout + metadata
├── page.tsx                # Redirect to /dashboard
├── globals.css             # Tailwind CSS + theme variables
├── login/page.tsx          # Auth login page
├── dashboard/              # Dashboard overview
├── campaigns/              # Campaign monitoring
├── agents/                 # Agent performance
├── settings/               # Profile page
└── api/
    ├── auth/[...nextauth]/ # NextAuth handler
    ├── dashboard/          # Dashboard aggregation
    ├── campaigns/          # Campaign CRUD + detail
    ├── agents/             # Agent aggregation
    ├── users/              # User management (Admin)
    ├── sales/              # Daily sales entry
    └── export/             # CSV exports
components/
├── ui/                     # ShadCN UI primitives
├── layout/                 # Sidebar, Navbar, BottomNav, etc.
├── charts/                 # Recharts components
├── kpi-card.tsx
├── export-button.tsx
└── providers.tsx
lib/
├── prisma.ts               # Singleton Prisma client
├── auth.ts                 # NextAuth config (rate-limited credentials)
├── permissions.ts          # Single source of truth for role-based access
├── rate-limit.ts           # Brute-force protection for login
├── logger.ts               # Structured JSON logging
└── utils.ts                # cn() helper
utils/
└── kpi.ts                  # KPI computation helpers
hooks/
└── use-data.ts             # SWR data hooks
prisma/
├── schema.prisma           # Database schema
└── seed.ts                 # Seed script
middleware.ts               # Route protection (backed by lib/permissions.ts)
```

---

## Testing & CI

Unit tests use **Vitest** (`npm test`). Coverage for the KPI math and
permission/rate-limit modules lives alongside the code in `__tests__/` folders.

| Command                | Purpose                                   |
| ---------------------- | ----------------------------------------- |
| `npm test`             | Run the unit test suite                   |
| `npm run test:watch`   | Watch mode                                |
| `npm run test:coverage`| Run with coverage report                  |
| `npm run lint`         | ESLint                                    |
| `npx tsc --noEmit`     | Typecheck                                 |
| `npm run prisma:format`| Format `prisma/schema.prisma`             |
| `npm run prisma:validate`| Validate the Prisma schema              |

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs lint, typecheck,
Prisma validate, and the full test suite on every push and pull request.

**Security:** credentials login is rate-limited (max 5 attempts / 10 min per
IP+email via `lib/rate-limit.ts`). Attempts are also persisted to the
`LoginAttempt` table (best-effort, for ephemeral serverless instances). This
table must be migrated (see below) for the durable backstop to take effect.

---

## Database Migrations

The project historically used `prisma db push`. For non-destructive, versioned
schema changes prefer Prisma Migrations:

```bash
npx prisma migrate dev --name <change>   # create + apply locally
npx prisma migrate deploy                # apply pending migrations in prod
```

> Note: a plain `prisma db push` may report **data-loss warnings** if the live
> database has drifted from `schema.prisma`. Do **not** pass
> `--accept-data-loss` unless you intentionally want to drop those columns.
> Prefer an additive migration (e.g. the `LoginAttempt` table) instead.

---

## Deployment (Vercel)

1. Push to GitHub
2. Import project in Vercel
3. Set environment variables in Vercel dashboard
4. Vercel auto-detects Next.js and builds

---

## License

Private — Business Dev Team
