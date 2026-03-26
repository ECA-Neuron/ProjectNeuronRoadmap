import { getNotionClient } from "./client";

export interface NotionDbInfo {
  id: string;
  title: string;
  properties: Record<string, { id: string; type: string; name: string }>;
}

// Notion SDK v5 narrowed the SearchResponse type to exclude databases.
// The API still returns them — we use `unknown` to avoid type conflicts.
interface RawSearchResult {
  object: string;
  id: string;
  title?: { plain_text: string }[];
}

/**
 * Search the workspace for a database by title.
 * Returns the first match with its property schema.
 */
export async function discoverDatabase(
  titleQuery: string
): Promise<NotionDbInfo | null> {
  const notion = getNotionClient();

  const res = await (notion.search as Function)({
    query: titleQuery,
    filter: { value: "data_source", property: "object" },
    page_size: 5,
  });

  const results = (res.results ?? []) as RawSearchResult[];
  const db = results.find((r) => {
    if (r.object !== "database") return false;
    const title = r.title?.map((t) => t.plain_text).join("") ?? "";
    return title.toLowerCase().includes(titleQuery.toLowerCase());
  });

  if (!db) return null;

  const full = await notion.databases.retrieve({
    database_id: db.id,
  }) as Record<string, unknown>;

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
    ? titleArr.map((t) => t.plain_text).join("")
    : titleQuery;

  return { id: full.id as string, title: titleText, properties };
}

/**
 * List all databases the integration can see (for admin debugging).
 */
export async function listDatabases(): Promise<
  { id: string; title: string }[]
> {
  const notion = getNotionClient();
  const res = await (notion.search as Function)({
    filter: { value: "data_source", property: "object" },
    page_size: 50,
  });

  const results = (res.results ?? []) as RawSearchResult[];
  return results
    .filter((r) => r.object === "database")
    .map((r) => {
      const title = r.title?.map((t) => t.plain_text).join("") ?? "(untitled)";
      return { id: r.id, title };
    });
}
