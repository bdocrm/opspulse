# Bulk Import Test Case

## Test Objective
Verify that collectors can upload CSV files with production data and records are created in the database.

## Prerequisites
- [ ] Server running: http://localhost:3002
- [ ] Logged in as COLLECTOR (manager@opspulse.com / password123)
- [ ] Campaign assigned to collector
- [ ] Agents in system

## Test Steps

### Step 1: Access Bulk Import Page
```
1. Navigate to http://localhost:3002/collector/bulk-import
2. Verify page loads with:
   - [ ] Page title: "Bulk Import"
   - [ ] Instructions visible
   - [ ] "Download CSV Template" button present
   - [ ] File upload area visible
   - [ ] "Upload" button disabled until file selected
   - [ ] Role check: Only COLLECTOR can access (redirects others to dashboard)
```

### Step 2: Download CSV Template
```
1. Click "Download CSV Template" button
2. Verify file downloads with name: bulk-import-template.csv
3. Open CSV file and verify headers:
   - AgentEmail
   - Date  
   - Transmittals
   - Activations
   - Approvals
   - Booked
4. Verify 4 example rows present (for reference)
```

### Step 3: Prepare Test Data
```
1. Create test CSV file with content:

AgentEmail,Date,Transmittals,Activations,Approvals,Booked
admin@opspulse.com,2026-03-11,50,45,40,35
admin@opspulse.com,2026-03-12,55,50,45,40

2. Save as "test-data.csv"
3. Verify file format (plain text, no extra sheets)
```

### Step 4: Upload CSV
```
1. Go to http://localhost:3002/collector/bulk-import
2. Method A - Drag & Drop:
   - [ ] Drag test-data.csv onto upload area
   - [ ] File appears in input field
   
   Method B - Click to Select:
   - [ ] Click upload area
   - [ ] Select test-data.csv from dialog
   - [ ] File appears in input field

3. Verify "Upload" button is now enabled
4. Click "Upload" button
```

### Step 5: Monitor Upload Progress
```
1. Verify upload starts (should be fast for small file)
2. Check for progress indication
3. Wait for completion message
```

### Step 6: Verify Success Results
```
Expected response should show:
- [ ] Success count: 2 (two rows)
- [ ] Errors count: 0
- [ ] Green success banner appears
- [ ] Detail table shows:
  Row | Agent | Date | Trans | Act | App | Booked
  1   | Admin User | 2026-03-11 | 50 | 45 | 40 | 35
  2   | Admin User | 2026-03-12 | 55 | 50 | 45 | 40
```

### Step 7: Database Verification
```
In database, verify ProductionDetail records created:
- [ ] Check ProductionEntry created for 2026-03-11
- [ ] Check ProductionEntry created for 2026-03-12
- [ ] Verify 2 ProductionDetail records linked to entries
- [ ] Verify agentId matches admin user
- [ ] Verify values: transmittals=50/55, activations=45/50, etc.
- [ ] Verify campaignId is set
```

### Step 8: Test Error Handling
```
1. Create malformed CSV (missing required columns):
   Date,Transmittals
   2026-03-11,50

2. Upload file
3. Verify error message: "Missing required headers: AgentEmail, ..."
4. Verify red error banner appears
5. Verify success count: 0
```

### Step 9: Test Invalid Email
```
1. Create CSV with non-existent agent:
   AgentEmail,Date,Transmittals,Activations,Approvals,Booked
   fake@email.com,2026-03-11,50,45,40,35

2. Upload file
3. Verify error: "Row 1: Agent not found"
4. Verify error banner shows
5. Verify success count: 0
```

### Step 10: Test Duplicate Upload
```
1. Upload same test-data.csv again
2. Verify system handles duplicate:
   - [ ] Either updates existing records OR
   - [ ] Prevents duplicates with error message
3. Verify data consistency in database
```

## Expected Behavior Summary

| Scenario | Expected Result |
|----------|-----------------|
| Valid CSV | Records created in DB, success message |
| Missing headers | Error: "Missing required headers" |
| Invalid email | Error: "Agent not found" |
| Invalid date | Error: "Invalid date format" |
| Non-numeric values | Error: "Invalid transmittals value" |
| Duplicate upload | Updates existing or shows error |
| Large file (>10MB) | Handles gracefully or shows size error |
| Empty file | Error: "No data to import" |

## Acceptance Criteria
- [ ] All valid data imports successfully
- [ ] All error cases handled gracefully
- [ ] Database records created with correct values
- [ ] UI shows appropriate success/error messages
- [ ] CSV template download works
- [ ] Role-based access working (COLLECTOR only)

## Notes
- Test with small files first (2-3 rows)
- Verify data in both UI result table and database
- Check sidebar link appears for COLLECTOR users
- Test on different browsers if possible
