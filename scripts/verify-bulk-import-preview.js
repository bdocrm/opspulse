const fs = require('fs');
const XLSX = require('xlsx');

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3003';

function mergeCookies(current, response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const jar = new Map(current.split('; ').filter(Boolean).map((item) => item.split(/=(.*)/s).slice(0, 2)));
  for (const value of values) {
    const pair = value.split(';', 1)[0];
    const [name, cookieValue] = pair.split(/=(.*)/s).slice(0, 2);
    jar.set(name, cookieValue);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function main() {
  let cookie = '';
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  cookie = mergeCookies(cookie, csrfResponse);
  const { csrfToken } = await csrfResponse.json();
  const loginResponse = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
    body: new URLSearchParams({
      csrfToken,
      email: 'collector.3@opsview.com',
      password: 'password123',
      callbackUrl: `${baseUrl}/collector/bulk-import`,
      json: 'true',
    }),
  });
  cookie = mergeCookies(cookie, loginResponse);

  const campaignsResponse = await fetch(`${baseUrl}/api/campaigns`, { headers: { cookie } });
  const campaigns = await campaignsResponse.json();
  const campaign = campaigns.find((row) => row.campaignName === 'BPI PL');
  if (!campaign) throw new Error('BPI PL campaign was not found');

  const bytes = fs.readFileSync('excel format/BPI.xlsx');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'BPI Dashboard 2026.xlsx');
  form.append('mode', 'preview');
  form.append('importMode', 'all');
  form.append('metricType', 'all');
  form.append('reportPeriodType', 'monthly');
  form.append('reportMonth', '7');
  form.append('reportYear', '2026');
  form.append('campaignId', campaign.id);
  form.append('reportDate', '2026-12-31');
  const previewResponse = await fetch(`${baseUrl}/api/collectors/bulk-import`, { method: 'POST', headers: { cookie }, body: form });
  const preview = await previewResponse.json();
  if (!previewResponse.ok) throw new Error(JSON.stringify(preview));
  console.log(JSON.stringify({
    workbookSummary: preview.workbookSummary,
    worksheets: preview.worksheetPreviews.map(({ matched, notFound, ...sheet }) => sheet),
    matched: preview.matched.length,
    notFound: preview.notFound.length,
    normalizedPreviewRecords: preview.previewRecords?.length || 0,
    monthSummary: preview.monthSummary,
    normalizedMetricSample: (preview.previewRecords || []).slice(0, 6),
    sample: [...preview.matched, ...preview.notFound].slice(0, 3),
  }, null, 2));

  const csv = [
    'Month,Full Name,Transmitted,Approvals,Booked,Volume',
    'January 2026,VERIFY JAN,10,8,6,1000',
    'February 2026,VERIFY FEB,11,9,7,1100',
    'March 2026,VERIFY MAR,12,10,8,1200',
    'April 2026,VERIFY APR,13,11,9,1300',
    'May 2026,VERIFY MAY,14,12,10,1400',
  ].join('\n');
  const csvForm = new FormData();
  csvForm.append('file', new Blob([csv], { type: 'text/csv' }), 'January to May 2026.csv');
  csvForm.append('mode', 'preview');
  csvForm.append('importMode', 'all');
  csvForm.append('metricType', 'all');
  csvForm.append('reportPeriodType', 'monthly');
  csvForm.append('reportMonth', '12');
  csvForm.append('reportYear', '2026');
  csvForm.append('campaignId', campaign.id);
  csvForm.append('reportDate', '2026-12-01');
  const csvResponse = await fetch(`${baseUrl}/api/collectors/bulk-import`, { method: 'POST', headers: { cookie }, body: csvForm });
  const csvPreview = await csvResponse.json();
  if (!csvResponse.ok) throw new Error(JSON.stringify(csvPreview));
  const detectedMonths = (csvPreview.monthSummary || []).map((month) => month.month);
  const expectedMonths = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
  if (JSON.stringify(detectedMonths) !== JSON.stringify(expectedMonths)) {
    throw new Error(`Expected ${expectedMonths.join(', ')}, received ${detectedMonths.join(', ')}`);
  }
  console.log(JSON.stringify({
    syntheticCsvRange: csvPreview.detectedRange,
    syntheticCsvMonthSummary: csvPreview.monthSummary,
    syntheticCsvDates: (csvPreview.previewRecords || []).map((record) => record.reportDate),
  }, null, 2));

  const multiSheetWorkbook = XLSX.utils.book_new();
  for (const [index, month] of ['January', 'February', 'March', 'April', 'May'].entries()) {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Full Name', 'Transmitted', 'Approvals', 'Booked', 'Volume'],
      [`VERIFY SHEET ${index + 1}`, 20 + index, 15 + index, 10 + index, 2000 + index * 100],
    ]);
    XLSX.utils.book_append_sheet(multiSheetWorkbook, sheet, `${month} 2026`);
  }
  const workbookBytes = XLSX.write(multiSheetWorkbook, { type: 'buffer', bookType: 'xlsx' });
  const workbookForm = new FormData();
  workbookForm.append('file', new Blob([workbookBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Multi-sheet January to May 2026.xlsx');
  workbookForm.append('mode', 'preview');
  workbookForm.append('importMode', 'all');
  workbookForm.append('metricType', 'all');
  workbookForm.append('reportPeriodType', 'monthly');
  workbookForm.append('reportMonth', '12');
  workbookForm.append('reportYear', '2026');
  workbookForm.append('campaignId', campaign.id);
  workbookForm.append('reportDate', '2026-12-01');
  const workbookResponse = await fetch(`${baseUrl}/api/collectors/bulk-import`, { method: 'POST', headers: { cookie }, body: workbookForm });
  const workbookPreview = await workbookResponse.json();
  if (!workbookResponse.ok) throw new Error(JSON.stringify(workbookPreview));
  if (workbookPreview.workbookSummary?.worksheetsAccepted !== 5 || workbookPreview.monthSummary?.length !== 5) {
    throw new Error(`Expected five accepted monthly worksheets, received ${JSON.stringify(workbookPreview.workbookSummary)}`);
  }
  console.log(JSON.stringify({
    syntheticWorkbookRange: workbookPreview.detectedRange,
    syntheticWorkbookSummary: workbookPreview.workbookSummary,
    syntheticWorkbookMonths: workbookPreview.monthSummary,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
