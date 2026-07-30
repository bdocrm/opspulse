const XLSX = require('xlsx');

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
const email = process.env.TEST_COLLECTOR_EMAIL || 'collector.9@opsview.com';
const password = process.env.TEST_COLLECTOR_PASSWORD || 'password123';

function mergeCookies(current, response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const jar = new Map(current.split('; ').filter(Boolean).map((item) => item.split(/=(.*)/s).slice(0, 2)));
  for (const value of values) {
    const [name, cookieValue] = value.split(';', 1)[0].split(/=(.*)/s).slice(0, 2);
    jar.set(name, cookieValue);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

function fixtureBytes() {
  const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const rows = [
    ['', '', ...months.flatMap((month) => [month, '']), 'TOTAL', '', '', 'TOTAL', '', '', 'TOTAL OF WHOLE YEAR', '', ''],
    ['NICKNAME', 'NAMES', ...months.flatMap(() => ['FINAL FC TOTAL', 'FINAL BC TOTAL']), 'TOTAL FC', 'TOTAL BC', 'RANKING', 'TOTAL FC', 'TOTAL BC', 'RANKING', 'TOTAL FC', 'TOTAL BC', 'RANKING'],
    ['VERIFY', 'AGENT, CONSOLIDATED VERIFY', 10, 5, '20', 13, ...Array(20).fill(null), 30, 18, 1, 0, 0, 1, 30, 18, 1],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!merges'] = [];
  for (let column = 2; column < 26; column += 2) {
    worksheet['!merges'].push({ s: { r: 0, c: column }, e: { r: 0, c: column + 1 } });
  }
  worksheet['!merges'].push(
    { s: { r: 0, c: 26 }, e: { r: 0, c: 28 } },
    { s: { r: 0, c: 29 }, e: { r: 0, c: 31 } },
    { s: { r: 0, c: 32 }, e: { r: 0, c: 33 } },
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'HOH');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
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
      email,
      password,
      callbackUrl: `${baseUrl}/collector/bulk-import`,
      json: 'true',
    }),
  });
  cookie = mergeCookies(cookie, loginResponse);

  const campaigns = await (await fetch(`${baseUrl}/api/campaigns`, { headers: { cookie } })).json();
  const campaign = campaigns.find((item) => item.campaignName === 'BDO SGM');
  if (!campaign) throw new Error('BDO SGM is not assigned to the test collector.');

  const form = new FormData();
  form.append('file', new Blob([fixtureBytes()]), 'CONSOLIDATED REPORTS fixture.xlsx');
  form.append('mode', 'preview');
  form.append('importMode', 'all');
  form.append('metricType', 'all');
  form.append('reportPeriodType', 'monthly');
  form.append('reportDate', '2026-07-01');
  form.append('reportMonth', '7');
  form.append('reportYear', '2026');
  form.append('campaignId', campaign.id);
  form.append('campaignIds', JSON.stringify([campaign.id]));
  form.append('duplicateMode', 'skip');

  const response = await fetch(`${baseUrl}/api/collectors/bulk-import`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  const preview = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(preview));
  if (preview.worksheetPreviews?.[0]?.format !== 'BDO SGM Consolidated') throw new Error('Consolidated format was not detected.');
  if (preview.consolidatedAgents?.length !== 1) throw new Error('Expected one agent preview row.');
  if (preview.previewRecords?.length !== 4) throw new Error(`Expected four populated monthly records, received ${preview.previewRecords?.length}.`);
  if (new Set(preview.previewRecords.map((record) => record.cardLevel)).size !== 2) throw new Error('FC and BC records were not kept separate.');
  if (preview.workbookSummary?.wholeYearTotalFc !== 30 || preview.workbookSummary?.wholeYearTotalBc !== 18) throw new Error('Whole-year totals were not calculated correctly.');
  if (preview.consolidatedAgents[0].fcMonths[6].available !== false) throw new Error('Blank July FC was not retained as unavailable.');

  console.log(JSON.stringify({
    format: preview.worksheetPreviews[0].format,
    agents: preview.consolidatedAgents.length,
    records: preview.previewRecords.length,
    cardLevels: [...new Set(preview.previewRecords.map((record) => record.cardLevel))],
    summary: preview.workbookSummary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
