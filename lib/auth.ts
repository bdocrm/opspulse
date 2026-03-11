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
            include: { campaign: true },
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

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            campaignId: user.campaignId,
            campaignName: user.campaign?.campaignName,
          };
        } catch (error) {
          console.error("❌ Auth error:", error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.campaignId = (user as any).campaignId;
        token.campaignName = (user as any).campaignName;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).campaignId = token.campaignId;
        (session.user as any).campaignName = token.campaignName;
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
