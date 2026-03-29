import { getNotionToken } from "./client";

export interface NotionDbInfo {
  id: string;
  title: string;
  properties: Record<string, { id: string; type: string; name: string }>;
  /** The token that successfully discovered this database */
  token: string;
}

const NOTION_V = "2022-06-28";

async function notionFetchWithToken(token: string, path: string, options?: { method?: string; body?: any }) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_V,
      "Content-Type": "application/json",
    },
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return res.json();
}

/**
 * Get all available Notion tokens: OAuth token (if available) AND env token (if different).
 */
async function getTokensToTry(): Promise<string[]> {
  const tokens: string[] = [];
  try {
    const primary = await getNotionToken();
    tokens.push(primary);
  } catch {}
  const envToken = process.env.NOTION_INTEGRATION_TOKEN;
  if (envToken && !tokens.includes(envToken)) {
    tokens.push(envToken);
  }
  return tokens;
}

async function searchDbWithToken(
  token: string,
  titleQuery: string
): Promise<{ db: any; token: string } | null> {
  const searchData = await notionFetchWithToken(token, "search", {
    method: "POST",
    body: {
      query: titleQuery,
      filter: { value: "database", property: "object" },
      page_size: 10,
    },
  });

  const results = (searchData.results ?? []) as any[];
  const db = results.find((r: any) => {
    if (r.object !== "database") return false;
    const title = r.title?.map((t: any) => t.plain_text).join("") ?? "";
    return title.toLowerCase().includes(titleQuery.toLowerCase());
  });

  if (db) return { db, token };

  const titles = results.map((r: any) => {
    const t = r.title?.map((x: any) => x.plain_text).join("") ?? "(untitled)";
    return `"${t}" (${r.id})`;
  }).join(", ");
  console.log(`[discover] Token ending ...${token.slice(-6)}: no match for "${titleQuery}". Visible DBs: [${titles}]`);
  return null;
}

/**
 * Search the workspace for a database by title.
 * Tries OAuth token first, then env var token as fallback.
 */
export async function discoverDatabase(
  titleQuery: string
): Promise<NotionDbInfo | null> {
  const tokens = await getTokensToTry();

  let foundDb: any = null;
  let foundToken: string = "";

  for (const token of tokens) {
    const result = await searchDbWithToken(token, titleQuery);
    if (result) {
      foundDb = result.db;
      foundToken = result.token;
      break;
    }
  }

  if (!foundDb) {
    console.log(`[discover] Database "${titleQuery}" not found with any of ${tokens.length} token(s).`);
    return null;
  }

  console.log(`[discover] Found database "${titleQuery}" with ID: ${foundDb.id} (token ...${foundToken.slice(-6)})`);

  const full = await notionFetchWithToken(foundToken, `databases/${foundDb.id}`);
  if (full.object === "error") {
    console.error(`[discover] databases.retrieve failed:`, full.message);
    return null;
  }

  const properties: NotionDbInfo["properties"] = {};
  const rawProps = (full.properties ?? {}) as Record<
    string,
    { id: string; type: string; name: string }
  >;
  for (const [name, prop] of Object.entries(rawProps)) {
    properties[name] = { id: prop.id, type: prop.type, name };
  }

  const titleArr = full.title as { plain_text: string }[] | undefined;
  const titleText = titleArr
    ? titleArr.map((t: any) => t.plain_text).join("")
    : titleQuery;

  return { id: full.id as string, title: titleText, properties, token: foundToken };
}

/**
 * List all databases any available token can see (for admin debugging).
 */
export async function listDatabases(): Promise<
  { id: string; title: string }[]
> {
  const tokens = await getTokensToTry();
  const seen = new Set<string>();
  const dbs: { id: string; title: string }[] = [];

  for (const token of tokens) {
    const searchData = await notionFetchWithToken(token, "search", {
      method: "POST",
      body: {
        filter: { value: "database", property: "object" },
        page_size: 50,
      },
    });

    const results = (searchData.results ?? []) as any[];
    for (const r of results) {
      if (r.object !== "database" || seen.has(r.id)) continue;
      seen.add(r.id);
      const title = r.title?.map((t: any) => t.plain_text).join("") ?? "(untitled)";
      dbs.push({ id: r.id, title });
    }
  }
  return dbs;
}
