# OpsPulse 360 - Campaign Access Control Setup (CLEAN SLATE)

## 🚀 SETUP STEPS (Run in Supabase SQL Editor)

### Step 1️⃣: CLEANUP (Remove Old Data)
**File**: `CLEANUP_DATA.sql`

1. Go to Supabase → SQL Editor → New Query
2. Copy & paste entire `CLEANUP_DATA.sql`
3. Click **Run**
4. Verify all tables are empty (see counts: 0)

### Step 2️⃣: MIGRATION (Update Database Schema)
**File**: `MIGRATION_CAMPAIGN_ACCESS.sql`

1. Create new query in SQL Editor
2. Copy & paste entire `MIGRATION_CAMPAIGN_ACCESS.sql`
3. Click **Run**
4. Wait for completion (see ✅ verification results)

### Step 3️⃣: SEED (Create Initial Data)
**File**: `SEED_DATA.sql` (v3 - No Agent Credentials)

1. Create new query in SQL Editor
2. Copy & paste entire `SEED_DATA.sql`
3. Click **Run**
4. You'll see login credentials table at bottom

---

## 🔐 Login Credentials After Setup

### CEO (Global Access)
```
Email: ceo@opspulse.com
Password: password123
Access: All 6 campaigns
```

### Campaign Teams (Example: BPI PA OUTBOUND)
```
COLLECTOR (Data Input):
  Email: collector.bpi.out@opspulse.com
  Password: password123

OM (Data Review):
  Email: om.bpi.out@opspulse.com
  Password: password123
```

**Same pattern for all campaigns:**
- BPI PA INBOUND
- BPI PL
- MB ACQ
- BDO SGM
- BPI BI

---

## ⚡ Important: AGENTS ARE NOT PRE-SEEDED

**Key Change**: Agents do NOT have login credentials pre-created.

Instead:
1. **COLLECTOR logs in** with their account
2. **COLLECTOR adds agents** through the UI with just their names + seat numbers
3. **Agents submit daily data** (authentication handled by collector/admin)

This matches your requirement: *"only the name of the agents will be input by the admin or collector"*

---

## 📊 System Structure After Setup

```
OpsPulse 360
│
├── CEO (ceo@opspulse.com)
│   └── Sees all 6 campaigns globally
│
├── Campaign: BPI PA OUTBOUND
│   ├── COLLECTOR: collector.bpi.out@opspulse.com
│   │   └── Manages agents (adds names, assigns seats)
│   │   └── Collects daily transmittals
│   ├── OM: om.bpi.out@opspulse.com
│   │   └── Reviews collected data
│   │   └── Forwards to CEO
│   └── AGENTS: Managed by COLLECTOR
│       └── Added through UI (names only, no login)
│       └── Submit daily data to collector
│
├── Campaign: BPI PA INBOUND (same structure)
├── Campaign: BPI PL (same structure)
├── Campaign: MB ACQ (same structure)
├── Campaign: BDO SGM (same structure)
└── Campaign: BPI BI (same structure)
```

---

## Database Schema Changes

### Role Enum (Updated)
- **Before**: ADMIN, MANAGER, AGENT
- **After**: CEO, COLLECTOR, OM, AGENT

### User Table
- ✅ Added: `campaignId` (links user to campaign, NULL for CEO)
- ✅ Added: `seatNumber` (for agent seat tracking)

### DailySales Table
- ✅ Added: `present` (boolean, default true)
- ✅ Added: `absent` (boolean, default false)

---

## Access Control Rules

| Role | Can Do | Cannot Do |
|------|--------|-----------|
| **CEO** | View all campaigns, all data | Edit/submit data |
| **COLLECTOR** | Add agents, view/collect their data | View other campaigns |
| **OM** | Review their campaign data | Edit data |
| **AGENT** | Submit daily metrics | View other agents |

---

## Next Steps After Setup

1. ✅ **Test CEO login**: View all campaigns
2. ✅ **Test COLLECTOR login**: Add agents for their campaign
3. ⏳ **Build Collector Dashboard** (for viewing agent submissions)
4. ⏳ **Build Agent Data Form** (for submitting transmittals)
5. ⏳ **Build OM Dashboard** (for reviewing & approving)
6. ⏳ **Update CEO Dashboard** (show all campaigns overview)

---

## Troubleshooting

| Error | Solution |
|-------|----------|
| "duplicate key" | Run CLEANUP_DATA.sql first to clear old data |
| "Role enum doesn't exist" | Run MIGRATION_CAMPAIGN_ACCESS.sql |
| Can't login with new credentials | Run SEED_DATA.sql (v3) |
| Agent columns missing | Run migration first, then regenerate Prisma: `npx prisma generate` |

---

## Password Reference

All accounts use: **password123**

This is a bcrypt hash in database:
```
$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi
```

To change passwords in Supabase SQL Editor:
```sql
UPDATE "User" SET password = '[new_bcrypt_hash]' WHERE email = 'email@opspulse.com';
```

Generate new bcrypt hash:
```bash
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('newPassword', 10, (err, hash) => { console.log(hash); });"
```
