const fs = require('fs');

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
    normalizedMetricSample: (preview.previewRecords || []).slice(0, 6),
    sample: [...preview.matched, ...preview.notFound].slice(0, 3),
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
