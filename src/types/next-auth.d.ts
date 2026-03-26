import { DefaultSession, DefaultUser } from "next-auth";

export type UserRole = "ADMIN" | "MEMBER" | "VIEWER";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    role: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: UserRole;
    id: string;
  }
}

