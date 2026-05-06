const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixCollectorCampaign() {
  try {
    // Get first campaign
    const campaign = await prisma.campaign.findFirst();
    if (!campaign) {
      console.error('❌ No campaigns found');
      return;
    }

    // Update collector
    const result = await prisma.user.update({
      where: { email: 'mbpa@gmail.com' },
      data: { campaignId: campaign.id },
      select: { email: true, name: true, campaignId: true }
    });

    console.log('✅ COLLECTOR updated successfully!');
    console.log('Email:', result.email);
    console.log('Name:', result.name);
    console.log('Campaign ID:', result.campaignId);
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixCollectorCampaign();
