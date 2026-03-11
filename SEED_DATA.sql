-- ============================================
-- OpsPulse 360 - Database Seed Script (v3)
-- Campaign-Based Multi-Tier Access Control
-- 
-- NOTE: Only CEO, COLLECTOR, and OM accounts are pre-seeded
-- AGENT accounts are created by COLLECTOR through the UI with agent names
-- ============================================
-- Password hash: password123 (bcrypt - verified with Node.js)

-- 1. Insert CEO User (can see all campaigns)
INSERT INTO "User" (id, name, email, password, role, "campaignId") 
VALUES (
  '99999999-9999-9999-9999-999999999999',
  'CEO Admin',
  'ceo@opspulse.com',
  '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi',
  'CEO',
  NULL
);

-- 2. Insert Campaigns
-- Create 6 sample campaigns (user can add more via UI, collectors manage their agents)
INSERT INTO "Campaign" (id, "campaignName", "goalType", "monthlyGoal", "kpiMetric") 
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'BPI PA OUTBOUND', 'sales', 1000000, 'transmittals'),
  ('11111111-1111-1111-1111-111111111112', 'BPI PA INBOUND', 'sales', 800000, 'transmittals'),
  ('11111111-1111-1111-1111-111111111113', 'BPI PL', 'sales', 500000, 'transmittals'),
  ('11111111-1111-1111-1111-111111111114', 'MB ACQ', 'activation', 2000, 'activations'),
  ('11111111-1111-1111-1111-111111111115', 'BDO SGM', 'quality', 95, 'qualityRate'),
  ('11111111-1111-1111-1111-111111111116', 'BPI BI', 'conversion', 80, 'conversionRate');

-- 3. Insert COLLECTOR and OM Users per Campaign (NO individual AGENT credentials)
-- BPI PA OUTBOUND Campaign
INSERT INTO "User" (id, name, email, password, role, "campaignId") 
VALUES 
  ('22222222-2222-2222-2222-222222222201', 'BPI Collector - PA OUT', 'collector.bpi.out@opspulse.com', '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi', 'COLLECTOR', '11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222202', 'BPI OM - PA OUT', 'om.bpi.out@opspulse.com', '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi', 'OM', '11111111-1111-1111-1111-111111111111');

-- BPI PA INBOUND Campaign
INSERT INTO "User" (id, name, email, password, role, "campaignId") 
VALUES 
  ('22222222-2222-2222-2222-222222222203', 'BPI Collector - PA IN', 'collector.bpi.in@opspulse.com', '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi', 'COLLECTOR', '11111111-1111-1111-1111-111111111112'),
  ('22222222-2222-2222-2222-222222222204', 'BPI OM - PA IN', 'om.bpi.in@opspulse.com', '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi', 'OM', '11111111-1111-1111-1111-111111111112');

-- BPI PL Campaign
INSERT INTO "User" (id, name, email, password, role, "campaignId") 
VALUES 
  ('22222222-2222-2222-2222-222222222205', 'BPI Collector - PL', 'collector.bpi.pl@opspulse.com', '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi', 'COLLECTOR', '11111111-1111-1111-1111-111111111113'),
  ('22222222-2222-2222-2222-222222222206', 'BPI OM - PL', 'om.bpi.pl@opspulse.com', '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi', 'OM', '11111111-1111-1111-1111-111111111113');

-- MB ACQ Campaign
INSERT INTO "User" (id, name, email, password, role, "campaignId") 
VALUES 
  ('22222222-2222-2222-2222-222222222207', 'MB Collector - ACQ', 'collector.mb.acq@opspulse.com', '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi', 'COLLECTOR', '11111111-1111-1111-1111-111111111114'),
  ('22222222-2222-2222-2222-222222222208', 'MB OM - ACQ', 'om.mb.acq@opspulse.com', '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi', 'OM', '11111111-1111-1111-1111-111111111114');

-- BDO SGM Campaign
INSERT INTO "User" (id, name, email, password, role, "campaignId") 
VALUES 
  ('22222222-2222-2222-2222-222222222209', 'BDO Collector - SGM', 'collector.bdo.sgm@opspulse.com', '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi', 'COLLECTOR', '11111111-1111-1111-1111-111111111115'),
  ('22222222-2222-2222-2222-222222222210', 'BDO OM - SGM', 'om.bdo.sgm@opspulse.com', '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi', 'OM', '11111111-1111-1111-1111-111111111115');

-- BPI BI Campaign
INSERT INTO "User" (id, name, email, password, role, "campaignId") 
VALUES 
  ('22222222-2222-2222-2222-222222222211', 'BPI Collector - BI', 'collector.bpi.bi@opspulse.com', '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi', 'COLLECTOR', '11111111-1111-1111-1111-111111111116'),
  ('22222222-2222-2222-2222-222222222212', 'BPI OM - BI', 'om.bpi.bi@opspulse.com', '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi', 'OM', '11111111-1111-1111-1111-111111111116');

-- 4. Display Login Credentials Available
SELECT '✅ Seed Complete - OpsPulse 360 Ready!' as status;

SELECT 'CEO (Global Access)' as "Role/Account Type", 'ceo@opspulse.com'::text as "Email", 'password123'::text as "Password"
UNION ALL
SELECT 'BPI PA OUTBOUND - Collector', 'collector.bpi.out@opspulse.com', 'password123'
UNION ALL
SELECT 'BPI PA OUTBOUND - OM', 'om.bpi.out@opspulse.com', 'password123'
UNION ALL
SELECT 'BPI PA INBOUND - Collector', 'collector.bpi.in@opspulse.com', 'password123'
UNION ALL
SELECT 'BPI PA INBOUND - OM', 'om.bpi.in@opspulse.com', 'password123'
UNION ALL
SELECT 'BPI PL - Collector', 'collector.bpi.pl@opspulse.com', 'password123'
UNION ALL
SELECT 'BPI PL - OM', 'om.bpi.pl@opspulse.com', 'password123'
UNION ALL
SELECT 'MB ACQ - Collector', 'collector.mb.acq@opspulse.com', 'password123'
UNION ALL
SELECT 'MB ACQ - OM', 'om.mb.acq@opspulse.com', 'password123'
UNION ALL
SELECT 'BDO SGM - Collector', 'collector.bdo.sgm@opspulse.com', 'password123'
UNION ALL
SELECT 'BDO SGM - OM', 'om.bdo.sgm@opspulse.com', 'password123'
UNION ALL
SELECT 'BPI BI - Collector', 'collector.bpi.bi@opspulse.com', 'password123'
UNION ALL
SELECT 'BPI BI - OM', 'om.bpi.bi@opspulse.com', 'password123'
ORDER BY 1, 2;
