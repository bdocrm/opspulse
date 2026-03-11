# OpsPulse 360 - Campaign-Based Access Control Implementation

## What Changed

### New Role System
- **CEO**: Can view all campaigns globally
- **COLLECTOR** (Admin): Inputs and collects agent transmittals for their campaign
- **OM** (Operational Manager): Views collected data for their campaign, forwards to CEO
- **AGENT**: Submits daily production data (with present/absent tracking)

### Database Schema Updates
1. **User table**:
   - `role` enum changed from (ADMIN, MANAGER, AGENT) to (CEO, COLLECTOR, OM, AGENT)
   - Added `campaignId` field to tie users to specific campaigns (NULL for CEO)

2. **DailySales table**:
   - Added `present` (boolean) - tracks if agent was present
   - Added `absent` (boolean) - tracks if agent was absent

3. **Campaign table**:
   - Added relationship to User for campaign team members

## Implementation Steps

### Step 1: Execute Database Migration
⚠️ **IMPORTANT**: Execute this in Supabase SQL Editor:

1. Go to Supabase Dashboard → Your Project → SQL Editor
2. Create a new query
3. Copy the entire contents of `MIGRATION_CAMPAIGN_ACCESS.sql`
4. Click "Run" and wait for completion
5. Verify the results show checkmarks (✅)

### Step 2: Seed New Data
After migration completes:

1. Create a new query in SQL Editor
2. Copy the entire contents of `SEED_DATA.sql` (the new v2 version)
3. Click "Run"
4. Note the login credentials displayed at the end

### Step 3: Test Campaign-Based Login
Try logging in with these campaign-specific accounts:

**CEO Account (Global Access)**
- Email: `ceo@opspulse.com`
- Password: `password123`

**BPI PA OUTBOUND Campaign Examples**
- Collector: `collector.bpi.out@opspulse.com`
- OM: `om.bpi.out@opspulse.com`
- Agent: `agent1.bpi.out@opspulse.com`

(Similar patterns for other campaigns)

## User Seat Tracking

Each campaign's agents have seat numbers (1, 2, 3, etc.):
- Each agent has a unique seat within their campaign
- Daily sales include `present` and `absent` tracking
- Helps determine head count and attendance

## Access Control Rules

The system will enforce:
- **COLLECTOR**: Can only view/edit their campaign's data
- **OM**: Can only view their campaign's data
- **CEO**: Can view all campaigns' data
- **AGENT**: Can only submit data for their campaign

## Important Notes

- Each campaign now has independent credentials
- Collectors manage their campaign's agent data submission
- OMs oversee data quality before forwarding to CEO
- The old hardcoded campaigns (Premium Sales, Activation Drive) have been removed
- New campaigns can be added via "Manage Campaigns" page (admin-only)

## Next Steps After Migration

1. Test login with different roles to verify access control
2. Update dashboard pages to filter data by campaign
3. Create data entry form for agents to input daily metrics
4. Add present/absent attendance tracking UI
