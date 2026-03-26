import { z } from "zod";

// ─── Initiative ────────────────────────────────
export const initiativeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  workstreamId: z.string().min(1, "Workstream is required"),
  category: z
    .enum(["CONNECTOR", "KIT_APP", "PORTAL", "AI_SYSTEM", "INFRA", "DEVSECOPS", "ROBOTICS", "TOOLING"])
    .optional(),
  plannedStartMonth: z.string().optional().nullable(),
  plannedEndMonth: z.string().optional().nullable(),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "DONE"]).optional(),
  tags: z.string().optional().nullable(),
  ownerInitials: z.string().optional().nullable(),
  needsRefinement: z.boolean().optional(),
  totalPoints: z.coerce.number().int().min(0).optional(),
});

// ─── SubTask ──────────────────────────────────
export const subTaskSchema = z.object({
  initiativeId: z.string().min(1, "Initiative is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  points: z.coerce.number().int().min(0).optional(),
  completionPercent: z.coerce.number().int().min(0).max(100).optional(),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "DONE"]).optional(),
  sortOrder: z.coerce.number().int().optional(),
  estimatedDays: z.coerce.number().min(0).optional().nullable(),
  unknowns: z.string().optional().nullable(),
  integration: z.string().optional().nullable(),
  assignedOrganization: z.enum(["ECLIPSE", "ACCENTURE"]).optional().nullable(),
});

// ─── Workstream ────────────────────────────────
export const workstreamSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required"),
  description: z.string().optional(),
  targetCompletionDate: z.string().optional().nullable(),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "DONE"]).optional(),
  color: z.string().optional().nullable(),
  programId: z.string().min(1),
});

// ─── Deliverable ──────────────────────────────
export const deliverableSchema = z.object({
  workstreamId: z.string().min(1, "Workstream is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "DONE"]).optional(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  points: z.coerce.number().int().min(0).optional(),
});

// ─── Milestone ─────────────────────────────────
export const milestoneSchema = z.object({
  name: z.string().min(1, "Name is required"),
  date: z.string().optional().nullable(),
  dateEnd: z.string().optional().nullable(),
  notes: z.string().optional(),
  initiativeId: z.string().optional().nullable(),
  programId: z.string().optional().nullable(),
});

// ─── Partner ───────────────────────────────────
export const partnerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  roleDescription: z.string().optional(),
  agreements: z.string().optional(),
  logoUrl: z.string().optional().nullable(),
});

// ─── Person ────────────────────────────────────
export const personSchema = z.object({
  name: z.string().min(1, "Name is required"),
  initials: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  team: z.string().optional().nullable(),
  roleInProgram: z.string().optional().nullable(),
});

// ─── Assignment ────────────────────────────────
export const assignmentSchema = z.object({
  personId: z.string().optional().nullable(),
  initiativeId: z.string().min(1, "Initiative is required"),
  month: z.string().min(1, "Month is required"),
  hoursPlanned: z.coerce.number().min(0).optional(),
  hoursActual: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
  outcome: z.string().optional(),
});

// ─── Artifact ──────────────────────────────────
export const artifactSchema = z.object({
  title: z.string().min(1, "Title is required"),
  url: z.string().optional().nullable(),
  type: z.enum(["DOC", "REPO", "DASHBOARD", "DEMO", "OTHER"]).optional(),
  initiativeId: z.string().optional().nullable(),
  partnerId: z.string().optional().nullable(),
});

// ─── Program ───────────────────────────────────
export const programSchema = z.object({
  name: z.string().min(1),
  mission: z.string().optional(),
  vision: z.string().optional(),
  successTenets: z.string().optional(),
  objectives: z.string().optional(),
  fyStartYear: z.coerce.number().optional(),
  fyEndYear: z.coerce.number().optional(),
});

// ─── Open Issue ─────────────────────────────────
export const openIssueSchema = z.object({
  workstreamId: z.string().min(1, "Workstream is required"),
  subTaskId: z.string().optional().nullable(),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional().nullable(),
  severity: z.enum(["STOPPING", "SLOWING", "NOT_A_CONCERN"]).optional(),
  screenshotUrl: z.string().optional().nullable(),
  assigneeIds: z.array(z.string()).optional(),
});

// ─── Issue Comment ──────────────────────────────
export const issueCommentSchema = z.object({
  issueId: z.string().min(1, "Issue is required"),
  parentId: z.string().optional().nullable(),
  body: z.string().min(1, "Comment cannot be empty"),
  authorName: z.string().optional().nullable(),
});

// ─── User (admin) ──────────────────────────────
export const userSchema = z.object({
  email: z.string().email("Valid email required"),
  name: z.string().optional(),
  password: z.string().min(6, "Min 6 characters").optional(),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).optional(),
});

// ─── Burn Snapshot ─────────────────────────────
export const burnSnapshotSchema = z.object({
  programId: z.string().optional(),
  featureId: z.string().optional(),
  goalId: z.string().optional(),
  date: z.string(),
  remainingWork: z.coerce.number().min(0),
  totalWork: z.coerce.number().min(0).optional().nullable(),
});

// ─── Documentation ─────────────────────────────
export const documentationSchema = z.object({
  title: z.string().min(1, "Title is required"),
  body: z.string().optional().default(""),
  entityType: z.enum(["PROGRAM", "WORKSTREAM", "INITIATIVE"]),
  programId: z.string().optional().nullable(),
  workstreamId: z.string().optional().nullable(),
  initiativeId: z.string().optional().nullable(),
  authorId: z.string().optional().nullable(),
});

// ─── Resource (resources page) ─────────────────
export const resourceSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email().optional().nullable(),
  hourlyRate: z.coerce.number().min(0).optional().nullable(),
  teamId: z.string().optional().nullable(),
});

// ─── Team (resources page) ────────────────────
export const teamSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

// ─── Roadmap Theme (features page) ─────────────
export const themeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sortOrder: z.coerce.number().int().optional(),
});

// ─── Cost entry (cost page) ────────────────────
export const costEntrySchema = z.object({
  date: z.string().min(1),
  featureId: z.string().optional().nullable(),
  goalId: z.string().optional().nullable(),
  issueId: z.string().optional().nullable(),
  amount: z.coerce.number().optional(),
  description: z.string().optional().nullable(),
});

// ─── Feature (features page) ──────────────────
export const featureSchema = z.object({
  name: z.string().min(1, "Name is required"),
  themeId: z.string().optional().nullable(),
  featureGroupId: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  plannedStart: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  sortOrder: z.coerce.number().int().optional(),
});

// ─── Goal (goals page) ─────────────────────────
export const goalSchema = z.object({
  name: z.string().min(1, "Name is required"),
  ownerId: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

// ─── Issue (issues page – tracking issues, not OpenIssue) ─
export const issueSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional().nullable(),
  featureId: z.string().optional().nullable(),
  goalId: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  status: z.string().optional(),
});
