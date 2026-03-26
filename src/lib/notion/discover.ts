import { getNotionClientAsync, getNotionToken } from "./client";

export interface NotionDbInfo {
  id: string;
  title: string;
  properties: Record<string, { id: string; type: string; name: string }>;
}

const NOTION_V = "2022-06-28";

/**
 * Raw fetch helper pinned to Notion API 2022-06-28.
 * The older version returns `database` objects with IDs that work with
 * databases.retrieve / databases.query (the newer SDK version returns
 * `data_source` objects whose IDs are incompatible with those endpoints).
 */
async function notionFetch(path: string, options?: { method?: string; body?: any }) {
  const token = await getNotionToken();
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
 * Search the workspace for a database by title.
 * Returns the first match with its property schema.
 *
 * Uses raw fetch with Notion API 2022-06-28 to get correct database IDs,
 * since the SDK v5 returns data_source IDs that are not queryable.
 */
export async function discoverDatabase(
  titleQuery: string
): Promise<NotionDbInfo | null> {
  const searchData = await notionFetch("search", {
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

  if (!db) {
    console.log(`[discover] No database found matching "${titleQuery}". Search returned:`,
      results.map((r: any) => ({ object: r.object, id: r.id }))
    );
    return null;
  }

  console.log(`[discover] Found database "${titleQuery}" with ID: ${db.id}`);

  // Retrieve full schema using the same old API version
  const full = await notionFetch(`databases/${db.id}`);
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

  return { id: full.id as string, title: titleText, properties };
}

/**
 * List all databases the integration can see (for admin debugging).
 */
export async function listDatabases(): Promise<
  { id: string; title: string }[]
> {
  const searchData = await notionFetch("search", {
    method: "POST",
    body: {
      filter: { value: "database", property: "object" },
      page_size: 50,
    },
  });

  const results = (searchData.results ?? []) as any[];
  return results
    .filter((r: any) => r.object === "database")
    .map((r: any) => {
      const title = r.title?.map((t: any) => t.plain_text).join("") ?? "(untitled)";
      return { id: r.id, title };
    });
}
