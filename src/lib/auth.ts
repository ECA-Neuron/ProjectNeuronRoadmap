import { NextAuthOptions } from "next-auth";
import { OAuthConfig } from "next-auth/providers/oauth";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@/types/next-auth";

interface NotionProfile {
  id: string;
  name: string;
  avatar_url: string | null;
  person?: { email: string };
  type: string;
}

function notionProvider(): OAuthConfig<NotionProfile> {
  return {
    id: "notion",
    name: "Notion",
    type: "oauth",
    authorization: {
      url: "https://api.notion.com/v1/oauth/authorize",
      params: { owner: "user", response_type: "code" },
    },
    token: {
      url: "https://api.notion.com/v1/oauth/token",
      async request({ params, provider }) {
        const basicAuth = Buffer.from(
          `${provider.clientId}:${provider.clientSecret}`
        ).toString("base64");

        const res = await fetch("https://api.notion.com/v1/oauth/token", {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code: params.code,
            redirect_uri: provider.callbackUrl,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Notion token exchange failed");
        }

        return {
          tokens: {
            access_token: data.access_token,
            token_type: data.token_type,
          },
        };
      },
    },
    userinfo: {
      url: "https://api.notion.com/v1/users/me",
      async request({ tokens }) {
        const res = await fetch("https://api.notion.com/v1/users/me", {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            "Notion-Version": "2022-06-28",
          },
        });
        const data = await res.json();
        return data.bot?.owner?.user ?? data;
      },
    },
    profile(profile) {
      return {
        id: profile.id,
        name: profile.name ?? null,
        email: profile.person?.email ?? null,
        image: profile.avatar_url ?? null,
        role: "VIEWER" as UserRole,
      };
    },
    clientId: process.env.NOTION_CLIENT_ID!,
    clientSecret: process.env.NOTION_CLIENT_SECRET!,
  };
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET || "development-secret-change-in-production",
  providers: [notionProvider()],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "notion" || !user.email) return true;

      const existing = await prisma.user.findUnique({
        where: { email: user.email },
      });

      if (!existing) {
        const newUser = await prisma.user.create({
          data: {
            email: user.email,
            name: user.name ?? user.email,
            role: "VIEWER",
          },
        });

        // Auto-link to an existing Person record by name
        if (user.name) {
          const person = await prisma.person.findFirst({
            where: {
              name: { equals: user.name, mode: "insensitive" },
              userId: null,
            },
          });
          if (person) {
            await prisma.person.update({
              where: { id: person.id },
              data: { userId: newUser.id },
            });
          }
        }
      }

      return true;
    },
    async jwt({ token, user, account }) {
      if (user && account) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email! },
          select: { id: true, role: true },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role as UserRole;
        }
      }
      // Refresh role from DB if missing (handles role changes by admin)
      if (!token.id && token.email) {
        const u = await prisma.user.findUnique({
          where: { email: token.email as string },
          select: { id: true, role: true },
        });
        if (u) {
          token.id = u.id;
          token.role = u.role as UserRole;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        session.user.id = token.id;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
};
