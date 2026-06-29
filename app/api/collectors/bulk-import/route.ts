import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';
import bcrypt from 'bcryptjs';

// Parse BPI PA Raw Excel rows - handles both single COUNT and multiple metrics
function parseExcelRows(rows: any[], metricType: string): { name: string; count: number; volume: number; transmittals?: number; approvals?: number; booked?: number; rowIdx: number }[] {
  let nameCol  = 1;
  let countCol = 3;
  let volumeCol = 4;
  let transmittalsCol = -1;
  let approvalsCol = -1;
  let bookedCol = -1;

  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i];
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || '').toLowerCase().trim();
      if (cell.includes('full name')) nameCol = j;
      if (cell === 'count') countCol = j;
      if (cell === 'volume') volumeCol = j;
      if (cell === 'transmitted') transmittalsCol = j;
      if (cell === 'approvals') approvalsCol = j;
      if (cell === 'booked') bookedCol = j;
    }
  }

  // First data row = first row where col 0 is a number
  let dataStartRow = 2;
  for (let i = 0; i < rows.length; i++) {
    if (typeof rows[i][0] === 'number') {
      dataStartRow = i;
      break;
    }
  }

  const entries: { name: string; count: number; volume: number; transmittals?: number; approvals?: number; booked?: number; rowIdx: number }[] = [];
  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const agentName = row[nameCol];
    if (!agentName || !String(agentName).trim()) continue;
    if (row[0] !== null && row[0] !== undefined && typeof row[0] !== 'number') continue;

    const volume = Math.max(0, Math.round(Number(row[volumeCol]) || 0));

    if (metricType === 'all_metrics') {
      // Try to read all three metrics from separate columns
      let transmittals = transmittalsCol >= 0 ? Math.max(0, Math.floor(Number(row[transmittalsCol]) || 0)) : 0;
      let approvals = approvalsCol >= 0 ? Math.max(0, Math.floor(Number(row[approvalsCol]) || 0)) : 0;
      let booked = bookedCol >= 0 ? Math.max(0, Math.floor(Number(row[bookedCol]) || 0)) : 0;

      // Fallback: if individual metric columns not found but COUNT column exists, use COUNT for transmittals
      if (transmittalsCol < 0 && approvalsCol < 0 && bookedCol < 0 && countCol >= 0) {
        transmittals = Math.max(0, Math.floor(Number(row[countCol]) || 0));
      }

      entries.push({ name: String(agentName).trim(), count: transmittals, volume, transmittals, approvals, booked, rowIdx: i + 1 });
    } else {
      // Single COUNT column
      const count = Math.max(0, Math.floor(Number(row[countCol]) || 0));
      entries.push({ name: String(agentName).trim(), count, volume, rowIdx: i + 1 });
    }
  }
  return entries;
}

function nameToEmail(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${slug}-${Date.now()}@imported.local`;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user?.role !== 'COLLECTOR') {
      return NextResponse.json({ error: 'Only collectors can bulk import' }, { status: 403 });
    }

    const collectorUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, campaignId: true },
    });

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const mode = (formData.get('mode') as string) || 'import';
    const metricType = (formData.get('metricType') as string) || 'transmittals';
    const reportDateStr = formData.get('reportDate') as string;
    const selectedCampaignId = (formData.get('campaignId') as string) || '';

    // Resolve the target campaign: prefer the one chosen on the import page,
    // otherwise fall back to the collector's assigned campaign.
    const effectiveCampaignId = selectedCampaignId || collectorUser?.campaignId;
    if (!effectiveCampaignId) {
      return NextResponse.json({ error: 'No campaign selected. Choose a campaign to import into.' }, { status: 400 });
    }

    const campaignExists = await prisma.campaign.findUnique({
      where: { id: effectiveCampaignId },
      select: { id: true },
    });
    if (!campaignExists) {
      return NextResponse.json({ error: 'Selected campaign not found' }, { status: 400 });
    }

    // If the collector has no campaign assigned yet, bind them to the one they
    // are importing into. Without this, their dashboard (which keys off the
    // collector's own campaign) would never show the imported agents.
    if (mode !== 'preview' && !collectorUser?.campaignId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { campaignId: effectiveCampaignId },
      });
    }

    let reportDate: Date;
    if (reportDateStr) {
      // Accepts a full date (YYYY-MM-DD); falls back to the 1st if only a month
      // (YYYY-MM) is provided, for backward compatibility.
      const [year, month, day] = reportDateStr.split('-').map(Number);
      reportDate = new Date(year, (month || 1) - 1, day || 1);
    } else {
      const now = new Date();
      reportDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const isExcel = file.name.toLowerCase().endsWith('.xlsx') || file.type.includes('spreadsheet');

    // ─── EXCEL PATH ───────────────────────────────────────────────────────────
    if (isExcel) {
      const fileBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(fileBuffer), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      if (!sheet) {
        return NextResponse.json({ error: 'No sheet found in Excel file' }, { status: 400 });
      }

      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 } as any);

      if (rows.length < 3) {
        return NextResponse.json({ error: 'Excel file has insufficient rows' }, { status: 400 });
      }

      const entries = parseExcelRows(rows, metricType);

      // ── PREVIEW MODE: classify agents, no DB writes ──────────────────────
      if (mode === 'preview') {
        const matched: any[] = [];
        const notFound: any[] = [];

        for (const entry of entries) {
          const agent = await prisma.user.findFirst({
            where: {
              name: { contains: entry.name, mode: 'insensitive' },
              campaignId: effectiveCampaignId,
            },
            select: { id: true, name: true },
          });

          const baseData: any = { name: entry.name, count: entry.count, volume: entry.volume };
          if (metricType === 'all_metrics') {
            baseData.transmittals = entry.transmittals;
            baseData.approvals = entry.approvals;
            baseData.booked = entry.booked;
          }

          if (agent) {
            matched.push({ ...baseData, agentId: agent.id, agentName: agent.name });
          } else {
            notFound.push(baseData);
          }
        }

        // Sort by volume descending, then by count/metrics descending
        matched.sort((a, b) => {
          if (b.volume !== a.volume) return b.volume - a.volume;
          return b.count - a.count;
        });
        notFound.sort((a, b) => {
          if (b.volume !== a.volume) return b.volume - a.volume;
          return b.count - a.count;
        });

        return NextResponse.json({ preview: true, matched, notFound, metricType, reportDate });
      }

      // ── IMPORT MODE ──────────────────────────────────────────────────────
      const confirmedNewAgents: string[] = JSON.parse(
        (formData.get('confirmedNewAgents') as string) || '[]'
      );

      // Create any confirmed new agents
      const createdAgents: Record<string, string> = {}; // name → id
      for (const name of confirmedNewAgents) {
        const existing = await prisma.user.findFirst({
          where: { name: { contains: name, mode: 'insensitive' }, campaignId: effectiveCampaignId },
          select: { id: true },
        });
        if (existing) {
          createdAgents[name] = existing.id;
          continue;
        }

        const email = nameToEmail(name);
        const password = await bcrypt.hash(crypto.randomUUID(), 10);
        const newAgent = await prisma.user.create({
          data: {
            name,
            email,
            password,
            role: 'AGENT',
            campaignId: effectiveCampaignId,
          },
        });
        createdAgents[name] = newAgent.id;
      }

      const results = {
        success: 0,
        created: confirmedNewAgents.length,
        errors: [] as string[],
        details: [] as any[],
      };

      // Create one ProductionEntry for the batch
      const entry = await prisma.productionEntry.create({
        data: {
          campaignId: effectiveCampaignId,
          date: reportDate,
          time: new Date().toLocaleTimeString(),
          createdBy: user.id,
        },
      });

      for (const row of entries) {
        try {
          let agent = await prisma.user.findFirst({
            where: {
              name: { contains: row.name, mode: 'insensitive' },
              campaignId: effectiveCampaignId,
            },
            select: { id: true, name: true },
          });

          // Use newly created agent if available
          if (!agent && createdAgents[row.name]) {
            agent = await prisma.user.findUnique({
              where: { id: createdAgents[row.name] },
              select: { id: true, name: true },
            });
          }

          if (!agent) {
            results.errors.push(`Row ${row.rowIdx}: Agent not found and not confirmed for creation ("${row.name}")`);
            continue;
          }

          const metricData: Record<string, bigint> = {
            transmittals: BigInt(0),
            approvals: BigInt(0),
            booked: BigInt(0),
            volume: BigInt(row.volume),
          };
          if (metricType === 'transmittals') metricData.transmittals = BigInt(row.count);
          else if (metricType === 'approvals') metricData.approvals = BigInt(row.count);
          else if (metricType === 'booked') metricData.booked = BigInt(row.count);
          else if (metricType === 'all_metrics') {
            metricData.transmittals = BigInt(row.transmittals || 0);
            metricData.approvals = BigInt(row.approvals || 0);
            metricData.booked = BigInt(row.booked || 0);
          }

          const existingDetail = await prisma.productionDetail.findUnique({
            where: {
              productionEntryId_agentId: {
                productionEntryId: entry.id,
                agentId: agent.id,
              },
            },
          });

          if (existingDetail) {
            await prisma.productionDetail.update({
              where: { id: existingDetail.id },
              data: metricData,
            });
          } else {
            await prisma.productionDetail.create({
              data: {
                productionEntryId: entry.id,
                agentId: agent.id,
                campaignId: effectiveCampaignId,
                ...metricData,
              },
            });
          }

          results.success++;
          const detail: any = {
            row: row.rowIdx,
            agent: agent.name,
            date: reportDate.toLocaleDateString(),
            volume: row.volume,
          };
          if (metricType === 'all_metrics') {
            detail.transmittals = row.transmittals;
            detail.approvals = row.approvals;
            detail.booked = row.booked;
          } else {
            detail[metricType] = row.count;
          }
          results.details.push(detail);
        } catch (rowError: any) {
          results.errors.push(`Row ${row.rowIdx}: ${rowError.message}`);
        }
      }

      // Sort results by volume descending, then by the primary metric
      results.details.sort((a, b) => {
        if (b.volume !== a.volume) return b.volume - a.volume;
        const aMetric = metricType === 'all_metrics' ? a.transmittals : a[metricType] || a.count || 0;
        const bMetric = metricType === 'all_metrics' ? b.transmittals : b[metricType] || b.count || 0;
        return bMetric - aMetric;
      });

      return NextResponse.json({
        message: `Imported ${results.success} records. ${results.created} new agent(s) created.`,
        ...results,
      });
    }

    // ─── CSV PATH — same BPI PA column format as Excel ───────────────────────
    const text = await file.text();
    const lines = text.trim().split('\n').filter(l => l.trim());

    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 });
    }

    // Convert CSV text to 2D array and reuse the same Excel parser
    const csvRows = lines.map(line =>
      line.split(',').map(cell => {
        const v = cell.trim().replace(/^"|"$/g, '');
        const n = Number(v);
        return v === '' ? null : isNaN(n) ? v : n;
      })
    );

    const csvEntries = parseExcelRows(csvRows, metricType);

    if (csvEntries.length === 0) {
      return NextResponse.json({ error: 'No data rows found. Check that your CSV matches the BPI PA template format.' }, { status: 400 });
    }

    // Preview mode for CSV
    if (mode === 'preview') {
      const matched: any[] = [];
      const notFound: any[] = [];

      for (const entry of csvEntries) {
        const agent = await prisma.user.findFirst({
          where: { name: { contains: entry.name, mode: 'insensitive' }, campaignId: effectiveCampaignId },
          select: { id: true, name: true },
        });

        const baseData: any = { name: entry.name, count: entry.count, volume: entry.volume };
        if (metricType === 'all_metrics') {
          baseData.transmittals = entry.transmittals;
          baseData.approvals = entry.approvals;
          baseData.booked = entry.booked;
        }

        if (agent) matched.push({ ...baseData, agentId: agent.id, agentName: agent.name });
        else notFound.push(baseData);
      }

      // Sort by volume descending, then by count/metrics descending
      matched.sort((a, b) => {
        if (b.volume !== a.volume) return b.volume - a.volume;
        return b.count - a.count;
      });
      notFound.sort((a, b) => {
        if (b.volume !== a.volume) return b.volume - a.volume;
        return b.count - a.count;
      });

      return NextResponse.json({ preview: true, matched, notFound, metricType, reportDate });
    }

    // Import mode for CSV
    const confirmedNewAgentsCsv: string[] = JSON.parse(
      (formData.get('confirmedNewAgents') as string) || '[]'
    );

    const createdAgentsCsv: Record<string, string> = {};
    for (const name of confirmedNewAgentsCsv) {
      const existing = await prisma.user.findFirst({
        where: { name: { contains: name, mode: 'insensitive' }, campaignId: effectiveCampaignId },
        select: { id: true },
      });
      if (existing) { createdAgentsCsv[name] = existing.id; continue; }

      const email = nameToEmail(name);
      const password = await bcrypt.hash(crypto.randomUUID(), 10);
      const newAgent = await prisma.user.create({
        data: { name, email, password, role: 'AGENT', campaignId: effectiveCampaignId },
      });
      createdAgentsCsv[name] = newAgent.id;
    }

    const csvResults = {
      success: 0,
      created: confirmedNewAgentsCsv.length,
      errors: [] as string[],
      details: [] as any[],
    };

    const csvProdEntry = await prisma.productionEntry.create({
      data: {
        campaignId: effectiveCampaignId,
        date: reportDate,
        time: new Date().toLocaleTimeString(),
        createdBy: user.id,
      },
    });

    for (const row of csvEntries) {
      try {
        let agent = await prisma.user.findFirst({
          where: { name: { contains: row.name, mode: 'insensitive' }, campaignId: effectiveCampaignId },
          select: { id: true, name: true },
        });
        if (!agent && createdAgentsCsv[row.name]) {
          agent = await prisma.user.findUnique({ where: { id: createdAgentsCsv[row.name] }, select: { id: true, name: true } });
        }
        if (!agent) {
          csvResults.errors.push(`Row ${row.rowIdx}: Agent not found and not confirmed for creation ("${row.name}")`);
          continue;
        }

        const metricData: Record<string, bigint> = {
          transmittals: BigInt(0),
          approvals: BigInt(0),
          booked: BigInt(0),
          volume: BigInt(row.volume),
        };
        if (metricType === 'transmittals') metricData.transmittals = BigInt(row.count);
        else if (metricType === 'approvals') metricData.approvals = BigInt(row.count);
        else if (metricType === 'booked') metricData.booked = BigInt(row.count);
        else if (metricType === 'all_metrics') {
          metricData.transmittals = BigInt(row.transmittals || 0);
          metricData.approvals = BigInt(row.approvals || 0);
          metricData.booked = BigInt(row.booked || 0);
        }

        const existingDetail = await prisma.productionDetail.findUnique({
          where: { productionEntryId_agentId: { productionEntryId: csvProdEntry.id, agentId: agent.id } },
        });
        if (existingDetail) {
          await prisma.productionDetail.update({ where: { id: existingDetail.id }, data: metricData });
        } else {
          await prisma.productionDetail.create({
            data: { productionEntryId: csvProdEntry.id, agentId: agent.id, campaignId: effectiveCampaignId, ...metricData },
          });
        }

        csvResults.success++;
        const detail: any = {
          row: row.rowIdx,
          agent: agent.name,
          date: reportDate.toLocaleDateString(),
          volume: row.volume,
        };
        if (metricType === 'all_metrics') {
          detail.transmittals = row.transmittals;
          detail.approvals = row.approvals;
          detail.booked = row.booked;
        } else {
          detail[metricType] = row.count;
        }
        csvResults.details.push(detail);
      } catch (rowError: any) {
        csvResults.errors.push(`Row ${row.rowIdx}: ${rowError.message}`);
      }
    }

    // Sort results by volume descending, then by the primary metric
    csvResults.details.sort((a, b) => {
      if (b.volume !== a.volume) return b.volume - a.volume;
      const aMetric = metricType === 'all_metrics' ? a.transmittals : a[metricType] || a.count || 0;
      const bMetric = metricType === 'all_metrics' ? b.transmittals : b[metricType] || b.count || 0;
      return bMetric - aMetric;
    });

    return NextResponse.json({
      message: `Imported ${csvResults.success} records. ${csvResults.created} new agent(s) created.`,
      ...csvResults,
    });
  } catch (error) {
    console.error('Bulk import error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
