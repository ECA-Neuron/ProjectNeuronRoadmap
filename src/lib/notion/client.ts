import { Client } from "@notionhq/client";
import { prisma } from "@/lib/prisma";

let _client: Client | null = null;
let _tokenSource: string = "";

/**
 * Get a Notion API client. Prefers a stored OAuth access_token from a user
 * who signed in via the Public Integration (which has workspace-level access).
 * Falls back to NOTION_INTEGRATION_TOKEN env var for internal integrations.
 */
export async function getNotionClientAsync(): Promise<Client> {
  // Try to get a stored OAuth token from any Notion account
  try {
    const account = await prisma.account.findFirst({
      where: {
        provider: "notion",
        access_token: { not: null },
      },
      orderBy: { id: "desc" },
      select: { access_token: true },
    });

    if (account?.access_token) {
      if (_tokenSource !== account.access_token) {
        _client = new Client({ auth: account.access_token });
        _tokenSource = account.access_token;
      }
      return _client!;
    }
  } catch {
    // DB not available yet, fall through to env var
  }

  return getNotionClient();
}

/**
 * Synchronous fallback using NOTION_INTEGRATION_TOKEN env var.
 */
export function getNotionClient(): Client {
  if (_client && _tokenSource === "env") return _client;

  const token = process.env.NOTION_INTEGRATION_TOKEN;
  if (!token) {
    throw new Error(
      "No Notion token available. Either sign in via Notion OAuth or set NOTION_INTEGRATION_TOKEN."
    );
  }

  _client = new Client({ auth: token });
  _tokenSource = "env";
  return _client;
}
