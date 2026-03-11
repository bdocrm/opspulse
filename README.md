# OpsPulse 360

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
DATABASE_URL="postgresql://postgres:<PASSWORD>@<HOST>:5432/opspulse"
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

**Default credentials:**

| Role    | Email                    | Password     |
| ------- | ------------------------ | ------------ |
| Admin   | admin@opspulse.com       | password123  |
| Manager | manager@opspulse.com     | password123  |
| Agent   | john.smith@opspulse.com  | password123  |

### 6. Run development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Features

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
├── auth.ts                 # NextAuth config
└── utils.ts                # cn() helper
utils/
└── kpi.ts                  # KPI computation helpers
hooks/
└── use-data.ts             # SWR data hooks
prisma/
├── schema.prisma           # Database schema
└── seed.ts                 # Seed script
middleware.ts               # Route protection
```

---

## Deployment (Vercel)

1. Push to GitHub
2. Import project in Vercel
3. Set environment variables in Vercel dashboard
4. Vercel auto-detects Next.js and builds

---

## License

Private — Business Dev Team
