import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
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

    if (!collectorUser?.campaignId) {
      return NextResponse.json({ error: 'Collector has no campaign assigned' }, { status: 400 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const results = {
      success: 0,
      errors: [] as string[],
      details: [] as any[],
    };

    // Detect file type
    const isExcel = file.name.toLowerCase().endsWith('.xlsx') || file.type.includes('spreadsheet');
    
    if (isExcel) {
      // Handle Excel (BPI.xlsx) format
      const fileBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(fileBuffer), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      if (!sheet) {
        return NextResponse.json({ error: 'No sheet found in Excel file' }, { status: 400 });
      }

      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 } as any);

      if (rows.length < 3) {
        return NextResponse.json({ 
          error: 'Excel file must have headers (rows 1-2) and data rows' 
        }, { status: 400 });
      }

      // Row 0 = Month names (January, February, March, etc.)
      // Row 1 = Metric names (Level, Status, Goal, Actual, Achievement)
      // Row 2+ = Data

      const monthRow = rows[0];
      const metricRow = rows[1];

      // Parse header structure to find month columns
      const months: { name: string; startCol: number; metrics: string[] }[] = [];
      let currentMonth = '';
      let currentMonthStart = -1;

      for (let col = 1; col < monthRow.length; col++) {
        if (monthRow[col] && String(monthRow[col]).trim()) {
          if (currentMonth && currentMonthStart !== -1) {
            const metrics = metricRow.slice(currentMonthStart, col).map((m: any) => String(m || '').trim());
            months.push({ name: currentMonth, startCol: currentMonthStart, metrics });
          }
          currentMonth = String(monthRow[col]).trim();
          currentMonthStart = col;
        }
      }

      // Add last month
      if (currentMonth && currentMonthStart !== -1) {
        const metrics = metricRow.slice(currentMonthStart).map((m: any) => String(m || '').trim());
        months.push({ name: currentMonth, startCol: currentMonthStart, metrics });
      }

      // Process data rows
      for (let rowIdx = 2; rowIdx < rows.length; rowIdx++) {
        try {
          const row = rows[rowIdx];
          const agentName = row[0];

          if (!agentName || !String(agentName).trim()) {
            continue; // Skip empty rows
          }

          // Find agent by name (partial match)
          const agent = await prisma.user.findFirst({
            where: {
              name: {
                contains: String(agentName).trim(),
                mode: 'insensitive',
              },
              campaignId: collectorUser.campaignId,
            },
            select: { id: true, name: true },
          });

          if (!agent) {
            results.errors.push(`Row ${rowIdx + 1}: Agent not found ("${agentName}")`);
            continue;
          }

          // Process each month's data
          for (const month of months) {
            const levelCol = month.startCol;
            const level = row[levelCol]; // Level
            const goalCol = month.startCol + 2;
            const actualCol = month.startCol + 3;

            const goal = Number(row[goalCol]) || 0;
            const actual = Number(row[actualCol]) || 0;

            if (goal <= 0 || actual <= 0) {
              continue; // Skip if no data
            }

            // Map month name to number
            const monthName = month.name.toLowerCase().trim();
            const monthMap: Record<string, number> = {
              january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
              july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
            };

            const monthNum = monthMap[monthName];
            if (monthNum === undefined) continue;

            const date = new Date(2026, monthNum, 1);

            // Create DailySales record
            const existingDaily = await prisma.dailySales.findFirst({
              where: {
                userId: agent.id,
                campaignId: collectorUser.campaignId,
                date,
              },
            });

            if (existingDaily) {
              await prisma.dailySales.update({
                where: { id: existingDaily.id },
                data: {
                  transmittals: BigInt(Math.round(actual)),
                  approvals: BigInt(Math.round(goal)),
                },
              });
            } else {
              await prisma.dailySales.create({
                data: {
                  userId: agent.id,
                  campaignId: collectorUser.campaignId,
                  date,
                  transmittals: BigInt(Math.round(actual)),
                  approvals: BigInt(Math.round(goal)),
                },
              });
            }

            results.success++;
            results.details.push({
              row: rowIdx + 1,
              agent: agent.name,
              month: month.name,
              level: level || 'N/A',
              goal: Math.round(goal),
              actual: Math.round(actual),
            });
          }
        } catch (rowError: any) {
          results.errors.push(`Row ${rowIdx + 1}: ${rowError.message}`);
        }
      }
    } else {
      // Handle CSV format (legacy)
      const text = await file.text();
      const lines = text.trim().split('\n');

      if (lines.length < 2) {
        return NextResponse.json({ error: 'CSV must have header and at least one row' }, { status: 400 });
      }

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const requiredHeaders = ['agentemail', 'date', 'transmittals', 'activations', 'approvals', 'booked'];
      
      for (const header of requiredHeaders) {
        if (!headers.includes(header)) {
          return NextResponse.json(
            { error: `Missing required column: ${header}` },
            { status: 400 }
          );
        }
      }

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row: any = {};

        headers.forEach((header, index) => {
          row[header] = values[index];
        });

        try {
          const agent = await prisma.user.findUnique({
            where: { email: row.agentemail },
            select: { id: true, name: true },
          });

          if (!agent) {
            results.errors.push(`Row ${i + 1}: Agent email not found: ${row.agentemail}`);
            continue;
          }

          const date = new Date(row.date);
          if (isNaN(date.getTime())) {
            results.errors.push(`Row ${i + 1}: Invalid date format: ${row.date}`);
            continue;
          }

          const transmittals = Math.max(0, Math.floor(Number(row.transmittals) || 0));
          const activations = Math.max(0, Math.floor(Number(row.activations) || 0));
          const approvals = Math.max(0, Math.floor(Number(row.approvals) || 0));
          const booked = Math.max(0, Math.floor(Number(row.booked) || 0));

          const entry = await prisma.productionEntry.create({
            data: {
              campaignId: collectorUser.campaignId,
              date,
              time: new Date().toLocaleTimeString(),
              createdBy: user.id,
            },
          });

          await prisma.productionDetail.create({
            data: {
              productionEntryId: entry.id,
              agentId: agent.id,
              campaignId: collectorUser.campaignId,
              transmittals: BigInt(transmittals),
              activations: BigInt(activations),
              approvals: BigInt(approvals),
              booked: BigInt(booked),
            },
          });

          results.success++;
          results.details.push({
            row: i + 1,
            agent: agent.name,
            date: row.date,
            transmittals,
            activations,
            approvals,
            booked,
          });
        } catch (rowError: any) {
          results.errors.push(`Row ${i + 1}: ${rowError.message}`);
        }
      }
    }

    return NextResponse.json({
      message: `Imported ${results.success} records successfully`,
      ...results,
    });
  } catch (error) {
    console.error('Bulk import error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
