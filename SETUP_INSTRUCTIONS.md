# Quick Setup Guide - Campaign-Based Access Control

## ⚠️ CRITICAL: Execute These Steps in Supabase SQL Editor

### Step 1: Run Database Migration
**Location**: `c:\xampp1\htdocs\OpsPulse\MIGRATION_CAMPAIGN_ACCESS.sql`

In Supabase Dashboard:
1. Go to **SQL Editor**
2. Create new query
3. Copy & paste entire `MIGRATION_CAMPAIGN_ACCESS.sql`
4. Click **"Run"**
5. Wait for completion (should see ✅ verification results)

### Step 2: Clear Old Data (Optional but Recommended)
```sql
-- Delete old test data if it exists
DELETE FROM "DailySales";
DELETE FROM "User";
DELETE FROM "Campaign";
```

### Step 3: Run New Seed Script
**Location**: `c:\xampp1\htdocs\OpsPulse\SEED_DATA.sql`

In the same SQL Editor:
1. Create new query
2. Copy & paste entire updated `SEED_DATA.sql`
3. Click **"Run"**
4. You'll see a table of login credentials

---

## 🔐 New Login Credentials

### CEO (Global Admin)
```
Email: ceo@opspulse.com
Password: password123
Access: All campaigns
```

### Campaign Teams (Example: BPI PA OUTBOUND)
```
Collector (Data Input):
  Email: collector.bpi.out@opspulse.com
  Password: password123
  
OM (Data Review):
  Email: om.bpi.out@opspulse.com
  Password: password123
  
Agents (Data Submission):
  Email: agent1.bpi.out@opspulse.com
  Email: agent2.bpi.out@opspulse.com
  Password: password123 (all agents)
```

### Other Campaigns Available
- **BPI PA INBOUND** (5 agents)
- **BPI PL** (4 agents)
- **MB ACQ** (3 agents)
- **BDO SGM** (4 agents)
- **BPI BI** (3 agents)

Each follows the pattern: `email.campaign.acronym@opspulse.com`

---

## New System Structure

```
OpsPulse 360
├── CEO (ceo@opspulse.com)
│   └── Views all campaigns
│
├── Campaign: BPI PA OUTBOUND
│   ├── COLLECTOR: collector.bpi.out@opspulse.com
│   │   └── Collects agent data, manages daily submissions
│   ├── OM: om.bpi.out@opspulse.com
│   │   └── Views collected data, reports to CEO
│   └── AGENTS: agent1-6.bpi.out@opspulse.com
│       └── Submit daily transmittals, attendance
│
├── Campaign: BPI PA INBOUND
│   ├── COLLECTOR
│   ├── OM
│   └── AGENTS (5)
│
... (4 more campaigns)
```

---

## What Each Role Can Do

### CEO
- ✅ View all campaigns
- ✅ View all daily sales data
- ✅ View agent performance across campaigns
- ❌ Cannot edit/submit data

### COLLECTOR
- ✅ View their campaign's agents
- ✅ View daily submissions from agents
- ✅ Prepare summary for OM
- ❌ Cannot view other campaigns

### OM
- ✅ View their campaign's daily data
- ✅ Review collected transmittals
- ✅ Forward reports to CEO
- ❌ Cannot submit or edit data

### AGENT
- ✅ Submit daily transmittals
- ✅ Record attendance (present/absent)
- ❌ Cannot view other agents' data

---

## Database Changes

### Role Enum Values
**Old**: ADMIN, MANAGER, AGENT
**New**: CEO, COLLECTOR, OM, AGENT

### User Table
- Added: `campaignId` (foreign key to Campaign, NULL for CEO)
- Added: `seatNumber` (agent's seat in campaign)

### DailySales Table
- Added: `present` (boolean, default true)
- Added: `absent` (boolean, default false)

---

## What Happens After Migration

1. **Old hardcoded campaigns removed**:
   - Premium Sales ❌
   - Activation Drive ❌
   - Quality Assurance ❌
   - Booking Blitz ❌

2. **New campaigns created**:
   - BPI PA OUTBOUND ✅
   - BPI PA INBOUND ✅
   - BPI PL ✅
   - MB ACQ ✅
   - BDO SGM ✅
   - BPI BI ✅

3. **Each campaign is independent**:
   - Separate login credentials
   - Separate data visibility
   - Separate team members

---

## Troubleshooting

**Error: "Role enum does not have value X"**
- Migration wasn't executed. Run `MIGRATION_CAMPAIGN_ACCESS.sql` first

**Error: "Foreign key constraint failed"**
- Old data still exists. Run the cleanup SQL in Step 2

**Login fails with new credentials**
- Seed script wasn't executed. Run `SEED_DATA.sql`

**Can't see new columns in Prisma**
- Need to regenerate Prisma client:
  ```bash
  npx prisma generate
  ```

---

## Next Features to Build

1. ✅ Campaign Management (already created)
2. ⏳ Agent Data Entry Form (daily transmittals)
3. ⏳ Collector Dashboard (collect & tally agent data)
4. ⏳ OM Review Dashboard (approve & send to CEO)
5. ⏳ CEO Global Dashboard (all campaigns overview)
