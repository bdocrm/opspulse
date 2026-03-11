# Goals Management Test Case

## Test Objective
Verify that CEO/OM can set campaign goals, configure weekly breakdowns, and assign individual agent targets.

## Prerequisites
- [ ] Server running: http://localhost:3002
- [ ] Logged in as CEO or OM (admin@opspulse.com / password123)
- [ ] At least one campaign exists with agents
- [ ] Agents assigned to campaign

## Test Steps

### Step 1: Access Goals Management Page
```
1. Navigate to http://localhost:3002/campaigns/goals
2. Verify page loads with:
   - [ ] Page title: "Goals Management"
   - [ ] Subtitle: "Set campaign and agent targets"
   - [ ] Campaign selector visible (button grid)
   - [ ] Campaign buttons show campaign names
   - [ ] At least one campaign button available
   - [ ] Role check: CEO/OM only (redirects others to dashboard)
```

### Step 2: Select Campaign
```
1. Click on a campaign button (e.g., "Sales Campaign")
2. Verify campaign is selected:
   - [ ] Button highlights in blue
   - [ ] "Campaign Goal" section appears
   - [ ] "Agent Targets" section appears
   - [ ] Summary card appears at bottom
```

### Step 3: Set Campaign Goal
```
1. In "Campaign Goal" section:
   - [ ] Locate "KPI Metric" input field
   - [ ] Locate "Monthly Goal" input field
   - [ ] "Weekly Breakdown" section visible

2. Enter test data:
   - KPI Metric: "Transmittals"
   - Monthly Goal: 1000

3. Verify weekly breakdown auto-calculates:
   - [ ] W1: 200
   - [ ] W2: 200
   - [ ] W3: 200
   - [ ] W4: 200
   - [ ] W5: 200
   - [ ] Total = 1000

4. Click "Save Campaign Goal" button
5. Verify success message: "Campaign goal updated successfully"
6. Verify data persists in fields
```

### Step 4: Set Agent Targets
```
1. Scroll to "Agent Targets" section
2. Verify table shows all agents in campaign:
   - [ ] Agent name visible
   - [ ] Seat number visible
   - [ ] Monthly Target input field present
   - [ ] Individual "Save" button per agent

3. For first agent:
   - [ ] Click Monthly Target input
   - [ ] Enter value: 300
   - [ ] Click "Save" button
   - [ ] Verify message: "Agent target updated successfully"
   - [ ] Value persists in field

4. For second agent:
   - [ ] Enter target: 250
   - [ ] Click Save
   - [ ] Verify success message

5. For remaining agents:
   - [ ] Set targets total ≤ 1000
   - [ ] E.g., if 5 agents: 300+250+200+150+100 = 1000
```

### Step 5: Verify Summary Card
```
1. Scroll to "Summary" section at bottom
2. Verify all metrics display:
   - [ ] Campaign Monthly Goal: 1000
   - [ ] Total Agent Targets: 1000 (sum of all agent targets)
   - [ ] Assigned Agents: 5 (total count)
   - [ ] Balance: 0 (Goal - Agent Targets)

3. If targets < goal:
   - [ ] Balance shows as green (e.g., +100)

4. If targets > goal:
   - [ ] Balance shows as orange (e.g., -50)
```

### Step 6: Switch Campaigns
```
1. Click on different campaign button
2. Verify:
   - [ ] Previous campaign goal saved to DB (check in next switch back)
   - [ ] New campaign loads with its own:
     - Goal value (or empty if not set)
     - KPI metric (or empty if not set)
     - Agent list (different agents)
     - Agent targets (different values)
   - [ ] Summary updates with new campaign data
```

### Step 7: Save and Reload
```
1. Set goals on a campaign:
   - Monthly Goal: 500
   - KPI Metric: "Units"
   - Agent targets: 100, 150, 250

2. Click "Save Campaign Goal"
3. Hard refresh page (Ctrl+R)
4. Verify:
   - [ ] Campaign still selected
   - [ ] Monthly Goal: 500 (persisted)
   - [ ] KPI Metric: "Units" (persisted)
   - [ ] Agent targets still show previous values
   - [ ] Summary reflects saved values
```

### Step 8: Test Edit Existing Goal
```
1. Select campaign with existing goal (from Step 7)
2. Change monthly goal: 500 → 600
3. Click "Save Campaign Goal"
4. Verify success message
5. Change specific agent target: 100 → 120
6. Click agent "Save" button
7. Verify success message and summary updates
8. Refresh and verify both changes persisted
```

### Step 9: Test OM vs CEO Access
```
If logged in as OM user:
1. Verify can only see OWN campaign
2. Cannot see other campaigns in selector
3. Cannot edit other campaigns

If logged in as CEO user:
1. Verify can see ALL campaigns
2. Can edit any campaign
3. Can set agent targets for any campaign
```

### Step 10: Test Unassigned Goals
```
1. Select campaign with NO agents assigned
2. Verify:
   - [ ] "Agent Targets" section shows: "No agents assigned to this campaign"
   - [ ] Can still set campaign goal
   - [ ] Summary shows: Assigned Agents: 0, Balance = Campaign Goal
```

## Expected Behavior Summary

| Action | Expected Result |
|--------|-----------------|
| Save campaign goal | Success message, data persists on reload |
| Save agent target | Success message, summary updates |
| Change campaign | New campaign loads with existing data |
| Invalid numeric input | Value resets or shows error (implementation dependent) |
| Empty monthly goal | Save fails with error message (required field) |
| OM editing own campaign | Save succeeds |
| OM editing other campaign | Access denied error |
| CEO editing any campaign | Save succeeds |

## Database Verification

After completing test steps, verify database:

```sql
-- Check campaign updated
SELECT id, campaignName, monthlyGoal, kpiMetric 
FROM "Campaign" 
WHERE id = 'test-campaign-id';

-- Check agent targets updated
SELECT u.id, u.name, u.monthlyTarget 
FROM "User" u 
WHERE u.campaignId = 'test-campaign-id';

-- Expected results:
-- Campaign: monthlyGoal = 1000, kpiMetric = "Transmittals"
-- Users: monthlyTarget = 300, 250, 200, 150, 100
```

## Acceptance Criteria
- [ ] Campaign goals save and persist
- [ ] Weekly breakdown auto-calculates correctly (goal / 5)
- [ ] Agent targets save individually
- [ ] Summary card shows correct totals and balance
- [ ] OM can only edit own campaign
- [ ] CEO can edit all campaigns
- [ ] Navigation between campaigns works smoothly
- [ ] All success/error messages display
- [ ] Data survives page reload

## Notes
- Test with different goal amounts (100, 500, 1000, 10000)
- Test with campaigns having 1, 5, 10+ agents
- Verify balance calculation when agents sum < goal
- Verify balance calculation when agents sum > goal
- Test on mobile view (responsiveness)
