import "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    role: string;
    campaignId?: string | null;
    campaignName?: string | null;
    campaignIds?: string[];
  }
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: string;
      campaignId?: string | null;
      campaignName?: string | null;
      campaignIds?: string[];
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    campaignId?: string | null;
    campaignName?: string | null;
    campaignIds?: string[];
  }
}
