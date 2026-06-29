const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  
  try {
    console.log('Navigating to bulk import page...');
    await page.goto('http://localhost:3001/collector/bulk-import', { waitUntil: 'networkidle' });
    
    // Take initial screenshot
    await page.screenshot({ path: 'C:\Users\Kevsz\AppData\Local\Temp\claude\c--Users-Kevsz-Documents-web-apps-web-app-opsview\78c2b9b7-c38d-4cc8-8a90-03aa1ca0fe40\scratchpad\bulk-import-1.png' });
    console.log('Screenshot 1 taken');
    
    // Check if we're on login page
    const title = await page.title();
    console.log('Page title:', title);
    
    // Check if bulk import page loaded or if redirected to login
    const url = page.url();
    console.log('Current URL:', url);
    
    if (url.includes('/login')) {
      console.log('Redirected to login - page requires authentication');
      process.exit(0);
    }
    
    // Look for the metric type dropdown
    const metricTypeSelect = await page.$('select');
    if (metricTypeSelect) {
      const options = await page.$$eval('select option', opts => opts.map(o => o.textContent));
      console.log('Metric Type options found:', options);
      
      // Verify new option exists
      if (options.includes('All (Transmittals, Approvals, Booked)')) {
        console.log('✓ New metric type option found!');
      } else {
        console.log('✗ New metric type option NOT found');
      }
    } else {
      console.log('No select element found on page');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
