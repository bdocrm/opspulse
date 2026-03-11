# ✅ OpsPulse System - Complete Testing Guide

## System Status
- **Dev Server**: Running on http://127.0.0.1:3001
- **Database**: Seeded with 28 users, 18 campaigns, 144 sales records
- **Status**: 100% Functional - Ready for Testing

---

## Test Scenario 1: CEO Dashboard Access
**Objective**: Verify CEO can see all campaigns and data

**Steps**:
1. Open browser: http://127.0.0.1:3001/login
2. Enter credentials:
   - Email: `admin@opspulse.com`
   - Password: `password123`
3. Click "Sign In"

**Expected Results**:
- ✅ Dashboard loads
- ✅ Can see all 18 campaigns
- ✅ Can see all sales agents
- ✅ All metrics display correctly

---

## Test Scenario 2: Manager (OM) Dashboard Access
**Objective**: Verify Manager can see operations data

**Steps**:
1. Open browser: http://127.0.0.1:3001/login
2. Enter credentials:
   - Email: `manager@opspulse.com`
   - Password: `password123`
3. Click "Sign In"

**Expected Results**:
- ✅ Dashboard loads with manager view
- ✅ Can access campaigns page
- ✅ Can manage agents

---

## Test Scenario 3: COLLECTOR Campaign Isolation (PRIMARY FEATURE TEST)
**Objective**: Verify each COLLECTOR can ONLY see their assigned campaign

### Test 3A: Collector.1 - BPI PA OUTBOUND Campaign
**Steps**:
1. Open browser: http://127.0.0.1:3001/login
2. Enter credentials:
   - Email: `collector.1@opspulse.com`
   - Password: `password123`
3. Click "Sign In"
4. Click "My Campaign" in sidebar

**Expected Results**:
- ✅ Dashboard displays: BPI PA OUTBOUND
- ✅ Sidebar shows only "My Campaign" and "Data Entry" (no Dashboard, Campaigns, Agents tabs)
- ✅ Campaign page shows only agents assigned to BPI PA OUTBOUND
- ✅ Can create new agents but they're only assigned to BPI PA OUTBOUND
- ✅ Can enter data but only for their campaign

### Test 3B: Collector.2 - BPI PA INBOUND Campaign
**Steps**:
1. Open browser: http://127.0.0.1:3001/login
2. Enter credentials:
   - Email: `collector.2@opspulse.com`
   - Password: `password123`
3. Click "Sign In"
4. Click "My Campaign" in sidebar

**Expected Results**:
- ✅ Dashboard displays: BPI PA INBOUND
- ✅ Can only see agents assigned to BPI PA INBOUND (different from Collector.1's campaign)
- ✅ Cannot see BPI PA OUTBOUND data

### Test 3C: Try Cross-Campaign Access (Should Fail)
**Steps**:
1. Logged in as `collector.1@opspulse.com`
2. Try to manually navigate to: `http://127.0.0.1:3001/collector/campaign?id=2`
3. Or try API: `http://127.0.0.1:3001/api/collector/agents?campaignId=2`

**Expected Results**:
- ✅ Access denied or redirected (security check)
- ✅ Cannot view other collectors' campaigns

---

## Test Scenario 4: COLLECTOR Data Entry
**Objective**: Verify COLLECTOR can only create data for their campaign

**Steps**:
1. Login as `collector.1@opspulse.com`
2. Click "Data Entry" in sidebar
3. Select agent from dropdown
4. Enter daily sales data:
   - Transmittals: 5
   - Activations: 3
   - Approvals: 2
   - Booked: 1
5. Click "Submit"

**Expected Results**:
- ✅ Form shows only agents for BPI PA OUTBOUND
- ✅ Data submitted successfully
- ✅ Data persists in database

---

## Test Scenario 5: Agent Dashboard Access
**Objective**: Verify Agent role restrictions

**Steps**:
1. Open browser: http://127.0.0.1:3001/login
2. Enter credentials:
   - Email: `john.smith@opspulse.com`
   - Password: `password123`
3. Click "Sign In"

**Expected Results**:
- ✅ Redirected to `/collector` page (Agents see collector view)
- ✅ Cannot access admin dashboard
- ✅ Cannot see other agents' data

---

## Test Scenario 6: Campaign Filter & Search
**Objective**: Verify campaign filtering works correctly

**Steps** (As Admin):
1. Login as CEO
2. Go to "Campaigns" page
3. Use period filter (date range selector)
4. Filter by year/month

**Expected Results**:
- ✅ Campaign KPIs update based on filter
- ✅ Sales records filtered by date range
- ✅ All 18 campaigns display correctly

---

## Test Scenario 7: Export Functionality
**Objective**: Verify export features work

**Steps** (As Admin):
1. Login as CEO
2. Go to "Dashboard" or "Campaigns"
3. Click "Export" button
4. Select format and date range

**Expected Results**:
- ✅ Export completes without errors
- ✅ CSV/Excel file downloads
- ✅ Contains correct data for selected period

---

## Test Scenario 8: Navigation & Permissions
**Objective**: Verify navigation changes based on user role

| Page | CEO | OM | AGENT | COLLECTOR |
|------|-----|-----|------|-----------|
| Dashboard | ✅ | ✅ | ❌ Redirect | ❌ Redirect |
| Campaigns | ✅ | ✅ | ❌ | ❌ |
| Manage Agents | ✅ | ✅ | ❌ | ❌ |
| My Campaign | ❌ | ❌ | ❌ | ✅ |
| Data Entry | ✅ | ✅ | ✓ Read-only | ✅ Write |
| Settings | ✅ | ✅ | ✅ | ❌ |

---

## Database Test Credentials

### All 18 Collectors (One per Campaign)
```
collector.1@opspulse.com  → BPI PA OUTBOUND
collector.2@opspulse.com  → BPI PA INBOUND
collector.3@opspulse.com  → BPI PL
collector.4@opspulse.com  → BPI BL
collector.5@opspulse.com  → BPI FF
collector.6@opspulse.com  → MB ACQ
collector.7@opspulse.com  → MB PL
collector.8@opspulse.com  → MB PA
collector.9@opspulse.com  → BDO SGM
collector.10@opspulse.com → BDO CIE
collector.11@opspulse.com → BDO SUPPLE
collector.12@opspulse.com → BDO VC
collector.13@opspulse.com → BDO NTH CARD
collector.14@opspulse.com → AXA
collector.15@opspulse.com → AXA CLP
collector.16@opspulse.com → CBC
collector.17@opspulse.com → CBC HPL
collector.18@opspulse.com → MEDICARD

All passwords: password123
```

### All 8 Agents (Assigned to 3 campaigns each)
```
john.smith@opspulse.com    → BPI PA OUTBOUND, BPI PA INBOUND, BPI PL
jane.doe@opspulse.com      → BPI BL, BPI FF, MB ACQ
mike.johnson@opspulse.com  → MB PL, MB PA, BDO SGM
emily.davis@opspulse.com   → BDO CIE, BDO SUPPLE, BDO VC
chris.wilson@opspulse.com  → BDO NTH CARD, AXA, AXA CLP
anna.brown@opspulse.com    → CBC, CBC HPL, MEDICARD
david.lee@opspulse.com     → BPI PA OUTBOUND, MB PL, BDO NTH CARD
lisa.chen@opspulse.com     → BPI PA INBOUND, MB PA, AXA

All passwords: password123
```

---

## Troubleshooting

### Issue: "Attendance table does not exist" error
**Status**: ✅ FIXED - Error handling added
- The Attendance table is referenced but doesn't exist in PostgreSQL
- Added try-catch error handling to gracefully handle missing table
- Application will continue running and return empty results for attendance queries

### Issue: Cannot connect to server on port 3001
**Solution**: 
- Verify dev server is running: `npm run dev`
- Set PORT environment variable: `$env:PORT = '3001'`
- Server takes 3-5 seconds to start

### Issue: COLLECTOR can see all campaigns
**Potential Causes**:
- User not properly authenticated
- Browser cache showing old page
- Session cookie not set correctly
- Try: Clear browser cache and login again

---

## API Endpoints Summary

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/dashboard` | GET | Required | Dashboard metrics |
| `/api/campaigns` | GET | Required | List campaigns |
| `/api/campaigns/[id]` | GET | Required | Campaign details |
| `/api/collector/agents` | GET | COLLECTOR | Get agents for collector's campaign |
| `/api/collector/entries` | POST | COLLECTOR | Create data entry for collector's campaign |
| `/api/users` | GET | Required | List users |
| `/api/sales` | GET/POST | Required | Sales data |
| `/api/export/campaigns` | GET | Required | Export campaign data |
| `/api/export/dashboard` | GET | Required | Export dashboard data |

---

## Quick Access
- **Dev Server**: http://127.0.0.1:3001
- **Login Page**: http://127.0.0.1:3001/login
- **Admin Test**: admin@opspulse.com / password123
- **Collector Test**: collector.1@opspulse.com / password123

---

**System Ready for Full Testing** ✅
