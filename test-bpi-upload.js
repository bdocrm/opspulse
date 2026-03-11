/**
 * Bulk Import Test - BPI.xlsx File
 * Tests uploading your actual BPI.xlsx file to the bulk import endpoint
 */

const fs = require('fs');
const path = require('path');

async function testBulkImportWithBPI() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  BULK IMPORT TEST - BPI.xlsx File                      ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const BASE_URL = 'http://localhost:3003';
  const BPI_FILE = 'excel format/BPI.xlsx';

  try {
    // Step 1: Check if BPI file exists
    console.log('📁 Step 1: Checking BPI.xlsx file...');
    if (!fs.existsSync(BPI_FILE)) {
      console.log(`❌ File not found: ${path.resolve(BPI_FILE)}`);
      process.exit(1);
    }
    const stats = fs.statSync(BPI_FILE);
    console.log(`✅ Found: ${BPI_FILE} (${(stats.size / 1024).toFixed(2)} KB)\n`);

    // Step 2: Read file for upload
    console.log('📤 Step 2: Preparing file for upload...');
    const fileBuffer = fs.readFileSync(BPI_FILE);
    console.log(`✅ File loaded (${fileBuffer.length} bytes)\n`);

    // Step 3: Create FormData and upload
    console.log('🚀 Step 3: Uploading to /api/collectors/bulk-import...');
    console.log('   Note: This will fail without authentication\n');

    // Without proper session, this will return 401, which is expected
    // This is just to verify the endpoint is reachable
    const form = new FormData();
    
    // Convert buffer to blob
    const blob = new Blob([fileBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    form.append('file', blob, 'BPI.xlsx');

    try {
      const response = await fetch(`${BASE_URL}/api/collectors/bulk-import`, {
        method: 'POST',
        body: form,
      });

      console.log(`   Status: ${response.status} ${response.statusText}`);
      const result = await response.json();
      
      if (response.status === 401) {
        console.log('   ❌ Unauthorized (expected - need auth session)\n');
        console.log('   ℹ️  To test with auth, use the browser:');
        console.log('   1. Go to http://localhost:3003/login');
        console.log('   2. Login as COLLECTOR (manager@opspulse.com / password123)');
        console.log('   3. Click "Bulk Import" in sidebar');
        console.log('   4. Upload BPI.xlsx file\n');
      } else {
        console.log('✅ Upload successful!');
        console.log('Response:', JSON.stringify(result, null, 2));
      }
    } catch (error) {
      console.log(`   ❌ Network error: ${error.message}`);
      console.log('   Is server running on http://localhost:3003?\n');
    }

    // Step 4: Show test instructions
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║  MANUAL BROWSER TEST INSTRUCTIONS                     ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    console.log('1️⃣  LOGIN:');
    console.log('   URL: http://localhost:3003/login');
    console.log('   Email: manager@opspulse.com');
    console.log('   Password: password123');
    console.log('   Role: COLLECTOR\n');

    console.log('2️⃣  NAVIGATE TO BULK IMPORT:');
    console.log('   Click "Bulk Import" in sidebar (left menu)\n');

    console.log('3️⃣  UPLOAD BPI FILE:');
    console.log('   Click upload area');
    console.log('   Select: ' + path.resolve(BPI_FILE));
    console.log('   System will auto-detect Excel format\n');

    console.log('4️⃣  VERIFY RESULTS:');
    console.log('   ✅ Green success banner');
    console.log('   ✅ Success count displayed');
    console.log('   ✅ Agent names shown from Column A');
    console.log('   ✅ Month-by-month data displayed');
    console.log('   ✅ Goal and Actual values shown\n');

    console.log('5️⃣  DATABASE CHECK:');
    console.log('   After upload, verify DailySales records created:');
    console.log('   - One record per agent per month');
    console.log('   - transmittals = Actual value');
    console.log('   - approvals = Goal value\n');

    console.log('════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Test Error:', error);
    process.exit(1);
  }
}

// Run test
testBulkImportWithBPI().catch(console.error);
