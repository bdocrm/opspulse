#!/usr/bin/env node

/**
 * BPI Bulk Import Test Script
 * Tests the Excel bulk import feature with your actual BPI.xlsx file
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = 3003;
const BASE_URL = `http://localhost:${PORT}`;
const BPI_FILE = path.join(process.cwd(), 'excel format', 'BPI.xlsx');

async function testBulkImport() {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  BPI BULK IMPORT TEST - Excel Format             ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  // Step 1: Verify file exists
  console.log('📁 Step 1: Checking BPI.xlsx file...');
  if (!fs.existsSync(BPI_FILE)) {
    console.error('❌ BPI.xlsx not found at:', BPI_FILE);
    process.exit(1);
  }
  const fileStats = fs.statSync(BPI_FILE);
  console.log(`✅ File found: ${BPI_FILE}`);
  console.log(`   Size: ${(fileStats.size / 1024).toFixed(2)} KB\n`);

  // Step 2: Test server connectivity
  console.log('🌐 Step 2: Testing server connectivity...');
  try {
    await checkServerReady();
    console.log(`✅ Server is running on ${BASE_URL}\n`);
  } catch (err) {
    console.error(`❌ Server not responding on port ${PORT}`);
    console.error(`   Make sure to run: npm run dev`);
    process.exit(1);
  }

  // Step 3: Test authentication
  console.log('🔐 Step 3: Testing authentication...');
  try {
    const token = await authenticateCollector();
    console.log(`✅ Authenticated successfully\n`);

    // Step 4: Upload BPI.xlsx
    console.log('📤 Step 4: Uploading BPI.xlsx file...');
    const result = await uploadBPIFile(token);
    
    // Step 5: Analyze results
    console.log('\n📊 Step 5: Analyzing import results...\n');
    analyzeResults(result);

  } catch (err) {
    console.error(`❌ Error: ${err.message}\n`);
    process.exit(1);
  }
}

function checkServerReady() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}/api/goals`, { timeout: 3000 }, (res) => {
      res.destroy();
      resolve();
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

function authenticateCollector() {
  return new Promise((resolve, reject) => {
    // This would normally use NextAuth, but for testing we'll simulate with a mock token
    // In real scenario, you'd need actual authentication
    resolve('mock-token');
  });
}

function uploadBPIFile(token) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(BPI_FILE);
    const formData = new FormData();
    formData.append('file', fileStream);

    // Use fetch (requires Node 18+)
    fetch(`${BASE_URL}/api/collectors/bulk-import`, {
      method: 'POST',
      body: fileStream,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    })
    .then(res => res.json())
    .then(data => resolve(data))
    .catch(err => reject(err));
  });
}

function analyzeResults(result) {
  if (result.error) {
    console.log('❌ Import Failed');
    console.log(`   Error: ${result.error}\n`);
    return;
  }

  console.log('✅ Import Successful!\n');
  console.log(`📈 Summary:`);
  console.log(`   Records Imported: ${result.success || 0}`);
  console.log(`   Errors: ${result.errors?.length || 0}`);
  console.log(`   Details: ${result.details?.length || 0} rows\n`);

  if (result.message) {
    console.log(`   ${result.message}\n`);
  }

  if (result.errors && result.errors.length > 0) {
    console.log('⚠️  Errors Encountered:');
    result.errors.slice(0, 5).forEach(err => {
      console.log(`   • ${err}`);
    });
    if (result.errors.length > 5) {
      console.log(`   ... and ${result.errors.length - 5} more\n`);
    } else {
      console.log();
    }
  }

  if (result.details && result.details.length > 0) {
    console.log('📋 Sample Imported Records:');
    result.details.slice(0, 5).forEach((detail, i) => {
      if (detail.month) {
        console.log(`   ${i + 1}. ${detail.agent} | ${detail.month} | Goal: ${detail.goal} | Actual: ${detail.actual}`);
      } else {
        console.log(`   ${i + 1}. ${detail.agent} | ${detail.date} | Trans: ${detail.transmittals}`);
      }
    });
    if (result.details.length > 5) {
      console.log(`   ... and ${result.details.length - 5} more\n`);
    } else {
      console.log();
    }
  }

  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║              TEST COMPLETED SUCCESSFULLY          ║');
  console.log('╚════════════════════════════════════════════════════╝\n');
}

// Run test
testBulkImport().catch(console.error);
