import { Client } from "@notionhq/client";

let _client: Client | null = null;

export function getNotionClient(): Client {
  if (_client) return _client;

  const token = process.env.NOTION_INTEGRATION_TOKEN;
  if (!token) {
    throw new Error(
      "NOTION_INTEGRATION_TOKEN is not set. Add it to your environment variables."
    );
  }

  _client = new Client({ auth: token });
  return _client;
}
