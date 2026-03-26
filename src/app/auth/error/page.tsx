"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

const errorMessages: Record<string, string> = {
  Configuration: "Server configuration error. Check that NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, and NEXTAUTH_SECRET environment variables are set.",
  AccessDenied: "Access denied. You may not have permission to sign in.",
  Verification: "The verification link has expired or has already been used.",
  OAuthSignin: "Error starting the Notion sign-in flow. Check the Notion integration configuration.",
  OAuthCallback: "Error during the Notion callback. The authorization may have been cancelled or the redirect URI may be misconfigured.",
  OAuthCreateAccount: "Could not create a user account. There may be a database connection issue.",
  Callback: "Error in the authentication callback. Check server logs for details.",
  Default: "An unexpected authentication error occurred.",
};

function ErrorContent() {
  const params = useSearchParams();
  const error = params.get("error") || "Default";
  const message = errorMessages[error] || errorMessages.Default;

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-800">
        <p className="font-medium mb-1">Error: {error}</p>
        <p>{message}</p>
      </div>
      <Link href="/auth/signin" className="block">
        <Button className="w-full">Try Again</Button>
      </Link>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-red-600">Sign-in Error</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-center text-sm text-muted-foreground">Loading...</p>}>
            <ErrorContent />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
