import { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          console.log("❌ Missing credentials");
          return null;
        }

        try {
          console.log(`🔍 Looking up user: ${credentials.email}`);
          
          const user = await prisma.user.findUnique({
            where: { email: credentials.email },
            include: { campaign: true, campaignAssignments: true },
          });

          if (!user) {
            console.log(`❌ User not found: ${credentials.email}`);
            return null;
          }

          console.log(`✅ User found: ${user.name}, Role: ${user.role}`);

          const isValid = await bcrypt.compare(credentials.password, user.password);
          console.log(`🔐 Password valid: ${isValid}`);
          
          if (!isValid) {
            console.log(`❌ Password mismatch for ${credentials.email}`);
            return null;
          }

          console.log(`✅ Auth successful for ${credentials.email}`);

          // Full assigned-campaign set (join table + legacy primary), de-duped.
          const campaignIds = Array.from(
            new Set(
              [
                user.campaignId,
                ...user.campaignAssignments.map((a) => a.campaignId),
              ].filter(Boolean) as string[]
            )
          );

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            campaignId: user.campaignId,
            campaignName: user.campaign?.campaignName,
            campaignIds,
          };
        } catch (error) {
          console.error("❌ Auth error:", error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.campaignId = (user as any).campaignId;
        token.campaignName = (user as any).campaignName;
        token.campaignIds = (user as any).campaignIds ?? [];
      } else if (
        token.id &&
        token.role !== "CEO" &&
        (trigger === "update" ||
          !token.campaignId ||
          !Array.isArray(token.campaignIds))
      ) {
        // Self-heal: campaign assignments may change after login (first bulk
        // import, or an admin editing the user's campaigns). Re-read the full
        // assigned set so the dashboard reflects it without a forced re-login.
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: {
            campaignId: true,
            campaign: { select: { campaignName: true } },
            campaignAssignments: { select: { campaignId: true } },
          },
        });
        if (dbUser) {
          token.campaignId = dbUser.campaignId;
          token.campaignName = dbUser.campaign?.campaignName;
          token.campaignIds = Array.from(
            new Set(
              [
                dbUser.campaignId,
                ...dbUser.campaignAssignments.map((a) => a.campaignId),
              ].filter(Boolean) as string[]
            )
          );
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).campaignId = token.campaignId;
        (session.user as any).campaignName = token.campaignName;
        (session.user as any).campaignIds = (token.campaignIds as string[]) ?? [];
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
