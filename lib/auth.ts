import { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/normalize-email";
import {
  consumeLoginAttempt,
  recordLoginAttempt,
} from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = normalizeEmail(credentials.email);

        // Best-effort IP resolution.
        const headers = (req?.headers as Record<string, string | string[] | undefined>) ?? {};
        const rawIp = headers["x-forwarded-for"] || headers["x-real-ip"];
        const ip = Array.isArray(rawIp) ? rawIp[0] : rawIp;

        // Rate limit: reject before the expensive bcrypt comparison once the
        // account+IP exceeds the allowed attempt window.
        const inMemory = consumeLoginAttempt(ip, email);
        if (!inMemory.allowed) {
          await recordLoginAttempt({ email, ip, success: false });
          return null;
        }

        try {
          const user = await prisma.user.findUnique({
            where: { email },
            include: { campaign: true, campaignAssignments: true },
          });

          const isValid = user ? await bcrypt.compare(credentials.password, user.password) : false;

          // Persist every attempt for the durable backstop.
          await recordLoginAttempt({ email, ip, success: isValid });

          if (!user || !isValid) return null;

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
          logger.errorWithCause("auth:authorize-error", error, { email });
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.campaignId = user.campaignId;
        token.campaignName = user.campaignName;
        token.campaignIds = user.campaignIds ?? [];
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
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.campaignId = token.campaignId;
        session.user.campaignName = token.campaignName;
        session.user.campaignIds = token.campaignIds ?? [];
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
