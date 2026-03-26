/**
 * Bidirectional mappers between Notion page properties and Prisma models.
 *
 * Notion "Level" column determines which dashboard model a page maps to:
 *   Workstream → Workstream
 *   Deliverable → Deliverable
 *   Feature → Initiative
 *   Task → SubTask
 */

import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotionLevel = "Workstream" | "Deliverable" | "Feature" | "Task";

export interface ParsedNotionPage {
  notionPageId: string;
  parentNotionId: string | null; // parent page id (sub-item hierarchy)
  level: NotionLevel | null;
  name: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  points: number;
  assignName: string | null;
  openIssuesFlag: boolean;
  lastEditedTime: Date;
}

// Notion status text → dashboard status enum
const STATUS_MAP: Record<string, string> = {
  "not started": "NOT_STARTED",
  "in progress": "IN_PROGRESS",
  "in-progress": "IN_PROGRESS",
  blocked: "BLOCKED",
  done: "DONE",
  complete: "DONE",
  completed: "DONE",
};

function mapStatus(notionStatus: string): string {
  return STATUS_MAP[notionStatus.toLowerCase().trim()] ?? "NOT_STARTED";
}

// ---------------------------------------------------------------------------
// Notion → DB  (pull)
// ---------------------------------------------------------------------------

function getPlainText(
  prop: PageObjectResponse["properties"][string]
): string {
  if (prop.type === "title") {
    return prop.title.map((t) => t.plain_text).join("");
  }
  if (prop.type === "rich_text") {
    return prop.rich_text.map((t) => t.plain_text).join("");
  }
  return "";
}

function getSelectValue(
  prop: PageObjectResponse["properties"][string]
): string | null {
  if (prop.type === "select" && prop.select) {
    return prop.select.name;
  }
  if (prop.type === "status" && prop.status) {
    return prop.status.name;
  }
  return null;
}

function getDateRange(
  prop: PageObjectResponse["properties"][string]
): { start: Date | null; end: Date | null } {
  if (prop.type === "date" && prop.date) {
    return {
      start: prop.date.start ? new Date(prop.date.start) : null,
      end: prop.date.end ? new Date(prop.date.end) : null,
    };
  }
  return { start: null, end: null };
}

function getNumber(
  prop: PageObjectResponse["properties"][string]
): number {
  if (prop.type === "number" && prop.number != null) {
    return prop.number;
  }
  return 0;
}

function getCheckbox(
  prop: PageObjectResponse["properties"][string]
): boolean {
  if (prop.type === "checkbox") {
    return prop.checkbox;
  }
  return false;
}

function getPeopleName(
  prop: PageObjectResponse["properties"][string]
): string | null {
  if (prop.type === "people" && prop.people.length > 0) {
    const p = prop.people[0] as { name?: string };
    return p.name ?? null;
  }
  return null;
}

/**
 * Parse a raw Notion page into a flat structure the sync engine can work with.
 * Property names are matched case-insensitively.
 */
export function parseNotionPage(page: PageObjectResponse): ParsedNotionPage {
  const props = page.properties;

  const findProp = (namePattern: string) => {
    const key = Object.keys(props).find(
      (k) => k.toLowerCase() === namePattern.toLowerCase()
    );
    return key ? props[key] : undefined;
  };

  const nameProp = findProp("name") ?? findProp("title");
  const name = nameProp ? getPlainText(nameProp) : "(untitled)";

  const levelProp = findProp("level");
  const levelRaw = levelProp ? getSelectValue(levelProp) : null;
  const level = (["Workstream", "Deliverable", "Feature", "Task"].find(
    (l) => l.toLowerCase() === (levelRaw ?? "").toLowerCase()
  ) ?? null) as NotionLevel | null;

  const statusProp = findProp("status");
  const statusRaw = statusProp ? getSelectValue(statusProp) : null;
  const status = statusRaw ? mapStatus(statusRaw) : "NOT_STARTED";

  const dateProp = findProp("date");
  const { start: startDate, end: endDate } = dateProp
    ? getDateRange(dateProp)
    : { start: null, end: null };

  const pointsProp = findProp("points") ?? findProp("story points");
  const points = pointsProp ? getNumber(pointsProp) : 0;

  const assignProp = findProp("assign") ?? findProp("assignee") ?? findProp("assigned");
  const assignName = assignProp ? getPeopleName(assignProp) : null;

  const flagProp = findProp("open issues flag") ?? findProp("open issues");
  const openIssuesFlag = flagProp ? getCheckbox(flagProp) : false;

  // Parent page id (for sub-item hierarchy)
  let parentNotionId: string | null = null;
  if (page.parent.type === "page_id") {
    parentNotionId = page.parent.page_id;
  }

  return {
    notionPageId: page.id,
    parentNotionId,
    level,
    name,
    status,
    startDate,
    endDate,
    points,
    assignName,
    openIssuesFlag,
    lastEditedTime: new Date(page.last_edited_time),
  };
}

// ---------------------------------------------------------------------------
// DB → Notion  (push)
// ---------------------------------------------------------------------------

interface DbRecord {
  name: string;
  status: string;
  startDate?: Date | null;
  endDate?: Date | null;
  points?: number;
}

const REVERSE_STATUS: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};

/**
 * Build a Notion properties object from a dashboard record.
 * Only includes fields that should be pushed back to Notion.
 */
export function buildNotionProperties(
  record: DbRecord,
  level: NotionLevel
): Record<string, unknown> {
  const props: Record<string, unknown> = {
    Name: { title: [{ text: { content: record.name } }] },
    Status: {
      select: {
        name: REVERSE_STATUS[record.status] ?? "Not started",
      },
    },
    Level: { select: { name: level } },
  };

  if (record.startDate || record.endDate) {
    props["Date"] = {
      date: {
        start: record.startDate
          ? record.startDate.toISOString().split("T")[0]
          : null,
        end: record.endDate
          ? record.endDate.toISOString().split("T")[0]
          : null,
      },
    };
  }

  if (record.points != null && record.points > 0) {
    props["Points"] = { number: record.points };
  }

  return props;
}
