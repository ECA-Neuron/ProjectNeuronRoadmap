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
          console.error("[Notion OAuth] Token exchange failed:", data);
          throw new Error(data.error || "Notion token exchange failed");
        }

        // Notion returns user info in the token response — store it for userinfo step
        console.log("[Notion OAuth] Token exchange success, owner type:", data.owner?.type);

        return {
          tokens: {
            access_token: data.access_token,
            token_type: data.token_type,
            // Pass owner info through as extra fields so userinfo can use it as fallback
            owner: data.owner,
          } as any,
        };
      },
    },
    userinfo: {
      url: "https://api.notion.com/v1/users/me",
      async request({ tokens }) {
        // First try the /users/me endpoint
        try {
          const res = await fetch("https://api.notion.com/v1/users/me", {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              "Notion-Version": "2022-06-28",
            },
          });
          const data = await res.json();
          console.log("[Notion OAuth] /users/me response type:", data.type, "bot owner:", data.bot?.owner?.type);

          // Extract the actual user from bot response
          const user = data.bot?.owner?.user;
          if (user?.id) return user;
        } catch (e) {
          console.error("[Notion OAuth] /users/me failed:", e);
        }

        // Fallback: use owner info from token response
        const owner = (tokens as any).owner;
        if (owner?.user) {
          console.log("[Notion OAuth] Using owner from token response");
          return owner.user;
        }

        console.error("[Notion OAuth] Could not extract user profile");
        throw new Error("Could not extract Notion user profile");
      },
    },
    profile(profile) {
      console.log("[Notion OAuth] Profile:", { id: profile.id, name: profile.name, email: profile.person?.email });
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
  debug: process.env.NODE_ENV === "development",
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "notion") return true;
      if (!user.email) {
        console.error("[Notion OAuth] No email in user profile — cannot create account");
        return true;
      }

      try {
        let dbUser = await prisma.user.findUnique({
          where: { email: user.email },
        });

        if (!dbUser) {
          dbUser = await prisma.user.create({
            data: {
              email: user.email,
              name: user.name ?? user.email,
              role: "VIEWER",
            },
          });
          console.log("[Notion OAuth] Created new user:", dbUser.email);

          if (user.name) {
            try {
              const person = await prisma.person.findFirst({
                where: {
                  name: { equals: user.name, mode: "insensitive" },
                  userId: null,
                },
              });
              if (person) {
                await prisma.person.update({
                  where: { id: person.id },
                  data: { userId: dbUser.id },
                });
                console.log("[Notion OAuth] Auto-linked person:", person.name);
              }
            } catch (e) {
              console.error("[Notion OAuth] Person link failed (non-fatal):", e);
            }
          }
        } else {
          console.log("[Notion OAuth] Existing user found:", dbUser.email);
        }

        // Store the Notion OAuth access token for server-side API sync
        if (account.access_token && dbUser) {
          try {
            await prisma.account.upsert({
              where: {
                provider_providerAccountId: {
                  provider: "notion",
                  providerAccountId: account.providerAccountId,
                },
              },
              update: {
                access_token: account.access_token,
              },
              create: {
                userId: dbUser.id,
                type: "oauth",
                provider: "notion",
                providerAccountId: account.providerAccountId,
                access_token: account.access_token,
              },
            });
            console.log("[Notion OAuth] Stored access token for sync");
          } catch (e) {
            console.error("[Notion OAuth] Token store failed (non-fatal):", e);
          }
        }
      } catch (e) {
        console.error("[Notion OAuth] signIn DB error (non-fatal):", e);
      }

      return true;
    },
    async jwt({ token, user, account }) {
      if (user && account) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email: user.email! },
            select: { id: true, role: true },
          });
          if (dbUser) {
            token.id = dbUser.id;
            token.role = dbUser.role as UserRole;
          }
        } catch (e) {
          console.error("[Notion OAuth] jwt callback DB error:", e);
        }
      } else if (token.email) {
        try {
          const u = await prisma.user.findUnique({
            where: { email: token.email as string },
            select: { id: true, role: true },
          });
          if (u) {
            token.id = u.id;
            token.role = u.role as UserRole;
          }
        } catch (e) {
          console.error("[Notion OAuth] jwt refresh DB error:", e);
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
    error: "/auth/error",
  },
};
