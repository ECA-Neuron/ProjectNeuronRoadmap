import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = await encode({
    token: {
      name: "Admin User",
      email: "admin@neuron.dev",
      role: "ADMIN",
      id: "dev-admin",
      sub: "dev-admin",
    },
    secret: process.env.NEXTAUTH_SECRET!,
  });

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const response = NextResponse.redirect(new URL("/roadmap", baseUrl));

  response.cookies.set("next-auth.session-token", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return response;
}
