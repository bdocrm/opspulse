const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const bcryptHash = '$2a$10$m8WD3n6ckYoisDBawArZ6eavo16dLP/pko7T/mJgXhHC4F34qSIwi'; // password123

(async () => {
  try {
    // Delete existing data
    await prisma.dailySales.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.campaign.deleteMany({});
    console.log('✅ Database cleared');

    // Create campaigns
    const campaigns = await prisma.campaign.createMany({
      data: [
        { id: '11111111-1111-1111-1111-111111111111', campaignName: 'BPI PA OUTBOUND', goalType: 'sales', monthlyGoal: 1000000, kpiMetric: 'transmittals' },
        { id: '11111111-1111-1111-1111-111111111112', campaignName: 'BPI PA INBOUND', goalType: 'sales', monthlyGoal: 800000, kpiMetric: 'transmittals' },
        { id: '11111111-1111-1111-1111-111111111113', campaignName: 'BPI PL', goalType: 'sales', monthlyGoal: 500000, kpiMetric: 'volume' },
        { id: '11111111-1111-1111-1111-111111111114', campaignName: 'MB ACQ', goalType: 'activation', monthlyGoal: 2000, kpiMetric: 'activations' },
        { id: '11111111-1111-1111-1111-111111111115', campaignName: 'BDO SGM', goalType: 'quality', monthlyGoal: 95, kpiMetric: 'qualityRate' },
        { id: '11111111-1111-1111-1111-111111111116', campaignName: 'MEDICARD', goalType: 'conversion', monthlyGoal: 80, kpiMetric: 'conversionRate' },
      ],
    });
    console.log(`✅ ${campaigns.count} campaigns created`);

    // Create CEO
    const ceo = await prisma.user.create({
      data: {
        id: '99999999-9999-9999-9999-999999999999',
        name: 'CEO Admin',
        email: 'ceo@opsview.com',
        password: bcryptHash,
        role: 'CEO',
        campaignId: null,
      },
    });
    console.log(`✅ CEO created: ${ceo.email} (${ceo.role})`);

    // Create COLLECTOR and OM users
    const users = [
      { id: '22222222-2222-2222-2222-222222222201', name: 'BPI Collector - PA OUT', email: 'collector.bpi.out@opsview.com', role: 'COLLECTOR', campaignId: '11111111-1111-1111-1111-111111111111' },
      { id: '22222222-2222-2222-2222-222222222202', name: 'BPI OM - PA OUT', email: 'om.bpi.out@opsview.com', role: 'OM', campaignId: '11111111-1111-1111-1111-111111111111' },
      { id: '22222222-2222-2222-2222-222222222203', name: 'BPI Collector - PA IN', email: 'collector.bpi.in@opsview.com', role: 'COLLECTOR', campaignId: '11111111-1111-1111-1111-111111111112' },
      { id: '22222222-2222-2222-2222-222222222204', name: 'BPI OM - PA IN', email: 'om.bpi.in@opsview.com', role: 'OM', campaignId: '11111111-1111-1111-1111-111111111112' },
      { id: '22222222-2222-2222-2222-222222222205', name: 'BPI Collector - PL', email: 'collector.bpi.pl@opsview.com', role: 'COLLECTOR', campaignId: '11111111-1111-1111-1111-111111111113' },
      { id: '22222222-2222-2222-2222-222222222206', name: 'BPI OM - PL', email: 'om.bpi.pl@opsview.com', role: 'OM', campaignId: '11111111-1111-1111-1111-111111111113' },
      { id: '22222222-2222-2222-2222-222222222207', name: 'MB Collector - ACQ', email: 'collector.mb.acq@opsview.com', role: 'COLLECTOR', campaignId: '11111111-1111-1111-1111-111111111114' },
      { id: '22222222-2222-2222-2222-222222222208', name: 'MB OM - ACQ', email: 'om.mb.acq@opsview.com', role: 'OM', campaignId: '11111111-1111-1111-1111-111111111114' },
      { id: '22222222-2222-2222-2222-222222222209', name: 'BDO Collector - SGM', email: 'collector.bdo.sgm@opsview.com', role: 'COLLECTOR', campaignId: '11111111-1111-1111-1111-111111111115' },
      { id: '22222222-2222-2222-2222-222222222210', name: 'BDO OM - SGM', email: 'om.bdo.sgm@opsview.com', role: 'OM', campaignId: '11111111-1111-1111-1111-111111111115' },
      { id: '22222222-2222-2222-2222-222222222211', name: 'MEDICARD Collector - CBC', email: 'collector.medicard.cbc@opsview.com', role: 'COLLECTOR', campaignId: '11111111-1111-1111-1111-111111111116' },
      { id: '22222222-2222-2222-2222-222222222212', name: 'MEDICARD OM - CBC', email: 'om.medicard.cbc@opsview.com', role: 'OM', campaignId: '11111111-1111-1111-1111-111111111116' },
    ];

    const createdUsers = await prisma.user.createMany({
      data: users.map(u => ({
        ...u,
        password: bcryptHash,
      })),
    });
    console.log(`✅ ${createdUsers.count} COLLECTOR/OM users created`);

    // Verify
    const ceoCheck = await prisma.user.findUnique({ where: { email: 'ceo@opsview.com' } });
    const collectorCheck = await prisma.user.findUnique({ where: { email: 'collector.bpi.out@opsview.com' } });
    const totalUsers = await prisma.user.count();

    console.log(`\n✅ SEED COMPLETE!`);
    console.log(`📊 Total users: ${totalUsers}`);
    console.log(`🧑‍💼 CEO: ${ceoCheck.email} (${ceoCheck.role})`);
    console.log(`📋 Collector: ${collectorCheck.email} (${collectorCheck.role})`);
    console.log(`\n📝 Login Credentials:`);
    console.log(`   Email: ceo@opsview.com`);
    console.log(`   Password: password123`);

    await prisma.$disconnect();
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
})();
