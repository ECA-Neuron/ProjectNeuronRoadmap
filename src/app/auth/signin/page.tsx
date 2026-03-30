"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignInPage() {
  const [loading, setLoading] = useState(false);

  const handleNotionSignIn = () => {
    setLoading(true);
    signIn("notion", { callbackUrl: "/my-dashboard" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="text-4xl mb-2">🧠</div>
          <CardTitle className="text-2xl">Project Neuron</CardTitle>
          <CardDescription>Sign in with your Notion account to continue</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleNotionSignIn}
            className="w-full h-12 text-base font-medium gap-3"
            disabled={loading}
          >
            <svg width="20" height="20" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.017 4.313l55.333-4.087c6.797-.583 8.543-.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277-1.553 6.807-6.99 7.193L24.467 99.967c-4.08.193-6.023-.39-8.16-3.113L3.3 79.94c-2.333-3.113-3.3-5.443-3.3-8.167V11.113c0-3.497 1.553-6.413 6.017-6.8z" fill="currentColor"/>
              <path d="M61.35.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257-3.89c5.433-.387 6.99-2.917 6.99-7.193V20.64c0-2.21-.87-2.847-3.443-4.733L75.24 3.463C71.1.383 69.35-.037 62.553.15L61.35.227zM25.69 19.543c-5.333.33-6.53.393-9.557-2.14l-5.58-4.473c-.953-.78-.573-1.753 1.553-1.943l53.193-3.887c4.467-.393 6.797 1.167 8.543 2.527l6.377 4.667c.587.39.78 1.167.193 1.167l-55.1 3.893-.62.19zM19.82 88.3V33.94c0-2.53.78-3.697 3.1-3.89l58.937-3.497c2.137-.193 3.107 1.167 3.107 3.693v54.167c0 2.53-1.36 4.667-3.883 4.86l-56.423 3.307c-2.53.19-4.84-.583-4.84-4.28zm53-51.087c.39 1.75 0 3.5-1.75 3.697l-2.72.577v40.04c-2.33 1.167-4.47 1.947-6.22 1.947-2.92 0-3.69-.973-5.82-3.5L38.84 51.5v26.437l5.62 1.363s0 3.5-4.85 3.5l-13.39.78c-.39-.78 0-2.723 1.36-3.11l3.5-.97V42.773l-4.86-.39c-.39-1.75.583-4.277 3.3-4.473l14.35-.97 18.48 28.467V41.197l-4.67-.583c-.39-2.14 1.17-3.693 3.11-3.887l13.2-.913z" fill="white"/>
            </svg>
            {loading ? "Redirecting to Notion..." : "Sign in with Notion"}
          </Button>
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1.5">
            <p className="font-semibold">Important: Select all databases when authorizing</p>
            <p>On the Notion authorization screen, make sure to grant access to:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li><strong>Neuron Workstreams Roadmap</strong></li>
              <li><strong>Roadmap Progress Log</strong></li>
              <li><strong>🔴 Open Issues</strong></li>
            </ul>
            <p className="text-amber-600 dark:text-amber-400">Click "Select pages" and check all three databases, or use "Select all".</p>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            New users are granted Viewer access by default.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
