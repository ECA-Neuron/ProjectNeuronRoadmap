"use client";

import Image from "next/image";
import { useState, useTransition, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createOpenIssue,
  updateOpenIssue,
  resolveOpenIssue,
  reopenIssue,
  deleteOpenIssue,
  setIssueAssignees,
  addIssueComment,
  deleteIssueComment,
} from "@/lib/actions/open-issues";
import { useTrackedSave } from "@/hooks/use-autosave";
import { useRole } from "@/hooks/use-role";

/* ─── Types ───────────────────────────────────────────── */

interface SubTaskRef {
  id: string;
  name: string;
  initiative?: { id: string; name: string } | null;
}

interface WorkstreamRef {
  id: string;
  name: string;
  slug: string;
  initiatives: {
    id: string;
    name: string;
    subTasks: { id: string; name: string }[];
  }[];
}

interface IssueComment {
  id: string;
  parentId: string | null;
  body: string;
  authorName: string | null;
  createdAt: string;
  mentions?: { person: { id: string; name: string; initials: string | null } }[];
}

interface OpenIssue {
  id: string;
  workstreamId: string;
  subTaskId: string | null;
  title: string;
  description: string | null;
  severity: string;
  screenshotUrl: string | null;
  createdAt: string;
  resolvedAt: string | null;
  workstream: { id: string; name: string; slug: string };
  subTask: SubTaskRef | null;
  assignees?: { person: PersonRef }[];
  comments: IssueComment[];
}

interface PersonRef {
  id: string;
  name: string;
  initials: string | null;
}

/* ─── Severity Config ─────────────────────────────────── */

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  STOPPING: { label: "Stopping", color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-300 dark:border-red-800" },
  SLOWING: { label: "Slowing", color: "text-yellow-700 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-300 dark:border-yellow-800" },
  NOT_A_CONCERN: { label: "Not a concern", color: "text-green-700 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/30", border: "border-green-300 dark:border-green-800" },
};

const SEVERITY_BADGE: Record<string, "destructive" | "secondary" | "outline"> = {
  STOPPING: "destructive",
  SLOWING: "secondary",
  NOT_A_CONCERN: "outline",
};

/* ─── Component ───────────────────────────────────────── */

export function OpenIssuesView({
  workstreams,
  issues: initialIssues,
  people = [],
  currentPersonId = null,
}: {
  workstreams: WorkstreamRef[];
  issues: OpenIssue[];
  people?: PersonRef[];
  currentPersonId?: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const trackedSave = useTrackedSave();
  const { canEdit } = useRole();
  const [filterWs, setFilterWs] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterMineOnly, setFilterMineOnly] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create form state
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newSeverity, setNewSeverity] = useState("NOT_A_CONCERN");
  const [newWs, setNewWs] = useState(workstreams[0]?.id || "");
  const [newSubTask, setNewSubTask] = useState("");
  const [newScreenshot, setNewScreenshot] = useState<string | null>(null);
  const [newAssignees, setNewAssignees] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  // Filtered issues
  const filtered = useMemo(() => {
    return initialIssues.filter((i) => {
      if (filterWs !== "all" && i.workstreamId !== filterWs) return false;
      if (filterSeverity !== "all" && i.severity !== filterSeverity) return false;
      if (!showResolved && i.resolvedAt) return false;
      if (filterMineOnly && currentPersonId) {
        const isAssigned = (i.assignees ?? []).some((a) => a.person.id === currentPersonId);
        const isMentioned = (i.comments ?? []).some((c) =>
          (c.mentions ?? []).some((m) => m.person.id === currentPersonId)
        );
        if (!isAssigned && !isMentioned) return false;
      }
      return true;
    });
  }, [initialIssues, filterWs, filterSeverity, showResolved, filterMineOnly, currentPersonId]);

  // Summary counts
  const openIssues = initialIssues.filter((i) => !i.resolvedAt);
  const stoppingCount = openIssues.filter((i) => i.severity === "STOPPING").length;
  const slowingCount = openIssues.filter((i) => i.severity === "SLOWING").length;
  const notConcernCount = openIssues.filter((i) => i.severity === "NOT_A_CONCERN").length;

  // Get subtasks for selected workstream in create form
  const selectedWsData = workstreams.find((w) => w.id === newWs);
  const availableSubTasks = selectedWsData?.initiatives.flatMap((init) =>
    init.subTasks.map((st) => ({ ...st, initiativeName: init.name }))
  ) || [];

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Convert to base64 data URL for storage (small screenshots)
    const reader = new FileReader();
    reader.onload = () => {
      setNewScreenshot(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  function handleCreate() {
    if (!newTitle.trim() || !newWs) return;
    startTransition(async () => {
      await trackedSave(() => createOpenIssue({
        workstreamId: newWs,
        subTaskId: newSubTask || null,
        title: newTitle.trim(),
        description: newDesc.trim() || null,
        severity: newSeverity,
        screenshotUrl: newScreenshot,
        assigneeIds: newAssignees.length > 0 ? newAssignees : undefined,
      }));
      setNewTitle("");
      setNewDesc("");
      setNewSeverity("NOT_A_CONCERN");
      setNewSubTask("");
      setNewScreenshot(null);
      setNewAssignees([]);
      setShowCreateForm(false);
      refresh();
    });
  }

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ text: string; type: "ok" | "err" } | null>(null);

  const doSync = async (direction: "pull" | "push") => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync/open-issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const data = await res.json();
      if (!res.ok) { setSyncMsg({ text: data.error ?? `Sync failed (${res.status})`, type: "err" }); return; }
      const label = direction === "pull" ? "Pulled" : "Pushed";
      const errCount = data.errors?.length ?? 0;
      const errText = errCount > 0 ? data.errors.join("; ") : "";
      setSyncMsg({ text: errCount > 0 ? errText : `${label} ${data.synced} issues`, type: errCount > 0 ? "err" : "ok" });
      if (data.synced > 0) refresh();
    } catch {
      setSyncMsg({ text: "Network error", type: "err" });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 15000);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Sync Toolbar ── */}
      <div className="flex items-center gap-2 justify-end">
        {syncMsg && (
          <span className={`text-[11px] px-2 py-1 rounded max-w-md ${
            syncMsg.type === "ok" ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
          }`}>{syncMsg.text}</span>
        )}
        <button
          onClick={() => doSync("pull")}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors disabled:opacity-50"
        >
          {syncing ? "Syncing..." : "Pull from Notion"}
        </button>
        <button
          onClick={() => doSync("push")}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800"
        >
          {syncing ? "Syncing..." : "Push to Notion"}
        </button>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Total Open</p>
            <p className="text-3xl font-bold">{openIssues.length}</p>
          </CardContent>
        </Card>
        <Card className="border-red-200 dark:border-red-900">
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-red-600 dark:text-red-400 font-semibold">🔴 Stopping</p>
            <p className="text-3xl font-bold text-red-600 dark:text-red-400">{stoppingCount}</p>
          </CardContent>
        </Card>
        <Card className="border-yellow-200 dark:border-yellow-900">
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-yellow-600 dark:text-yellow-400 font-semibold">🟡 Slowing</p>
            <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">{slowingCount}</p>
          </CardContent>
        </Card>
        <Card className="border-green-200 dark:border-green-900">
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-green-600 dark:text-green-400 font-semibold">🟢 Not a Concern</p>
            <p className="text-3xl font-bold text-green-600 dark:text-green-400">{notConcernCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Filters + Create ── */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center">
          <select
            className="rounded-md border px-3 py-1.5 text-sm bg-background"
            value={filterWs}
            onChange={(e) => setFilterWs(e.target.value)}
          >
            <option value="all">All Workstreams</option>
            {workstreams.map((ws) => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
          </select>
          <select
            className="rounded-md border px-3 py-1.5 text-sm bg-background"
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
          >
            <option value="all">All Severities</option>
            <option value="STOPPING">Stopping</option>
            <option value="SLOWING">Slowing</option>
            <option value="NOT_A_CONCERN">Not a Concern</option>
          </select>
          {currentPersonId && (
            <Button
              size="sm"
              variant={filterMineOnly ? "default" : "outline"}
              className="text-xs"
              onClick={() => setFilterMineOnly((v) => !v)}
              title="Same set as Open Issues on My Dashboard"
            >
              My issues
            </Button>
          )}
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              className="rounded"
            />
            Show resolved
          </label>
          <span className="text-xs text-muted-foreground">
            Showing {filtered.length} issue{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => setShowCreateForm(true)}
            disabled={isPending}
            className="font-semibold text-white shadow-md border-0 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 dark:from-violet-500 dark:to-indigo-500 dark:hover:from-violet-400 dark:hover:to-indigo-400"
          >
            + New Issue
          </Button>
        )}
      </div>

      {/* ── Create Issue Form (modal) ── */}
      {showCreateForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-issue-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            aria-label="Close dialog"
            onClick={() => setShowCreateForm(false)}
          />
          <div className="relative z-10 flex max-h-[min(90vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl shadow-black/20 dark:shadow-black/40">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 bg-card px-6 py-4">
              <div className="min-w-0 pr-2">
                <h3 id="create-issue-title" className="text-base font-semibold tracking-tight">
                  Report new issue
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Add details, severity, and who should own follow-up.
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setShowCreateForm(false)}
                aria-label="Close"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                    Title <span className="text-destructive">*</span>
                  </label>
                  <Input
                    className="h-10 rounded-lg border-border/80"
                    placeholder="Brief issue title…"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-2 block text-xs font-semibold text-muted-foreground">Severity</label>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Issue severity">
                    {(["STOPPING", "SLOWING", "NOT_A_CONCERN"] as const).map((key) => {
                      const cfg = SEVERITY_CONFIG[key];
                      const selected = newSeverity === key;
                      const subtitles: Record<typeof key, string> = {
                        STOPPING: "Blocks work entirely",
                        SLOWING: "Degraded progress",
                        NOT_A_CONCERN: "Low priority for now",
                      };
                      return (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setNewSeverity(key)}
                          className={`flex min-w-0 flex-1 flex-col items-start rounded-xl border px-3.5 py-2.5 text-left text-xs transition-all sm:min-w-[140px] sm:flex-none ${
                            selected
                              ? `${cfg.bg} ${cfg.border} ${cfg.color} ring-2 ring-primary/25 ring-offset-2 ring-offset-background`
                              : "border-border/80 bg-muted/25 text-muted-foreground hover:border-border hover:bg-muted/40"
                          }`}
                        >
                          <span className={`font-semibold ${selected ? cfg.color : "text-foreground"}`}>
                            {cfg.label}
                          </span>
                          <span className="mt-0.5 text-[11px] opacity-80">{subtitles[key]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                    Workstream <span className="text-destructive">*</span>
                  </label>
                  <select
                    className="h-10 w-full rounded-lg border border-border/80 bg-background px-3 text-sm"
                    value={newWs}
                    onChange={(e) => {
                      setNewWs(e.target.value);
                      setNewSubTask("");
                    }}
                  >
                    {workstreams.map((ws) => (
                      <option key={ws.id} value={ws.id}>
                        {ws.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                    Blocks sub-task (optional)
                  </label>
                  <select
                    className="h-10 w-full rounded-lg border border-border/80 bg-background px-3 text-sm"
                    value={newSubTask}
                    onChange={(e) => setNewSubTask(e.target.value)}
                  >
                    <option value="">— None —</option>
                    {availableSubTasks.map((st) => (
                      <option key={st.id} value={st.id}>
                        [{st.initiativeName}] {st.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Assign to</label>
                  <p className="mb-2 text-[11px] text-muted-foreground">Select one or more people. You can change this later on the issue card.</p>
                  {people.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No people available to assign.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {people.map((p) => {
                        const selected = newAssignees.includes(p.id);
                        const label = p.initials || p.name.slice(0, 2).toUpperCase();
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() =>
                              setNewAssignees((prev) =>
                                selected ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                              )
                            }
                            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-left text-xs font-medium transition-all ${
                              selected
                                ? "border-primary bg-primary/10 text-primary shadow-sm"
                                : "border-border/80 bg-muted/20 text-muted-foreground hover:border-border hover:bg-muted/35"
                            }`}
                          >
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                                selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {label}
                            </span>
                            <span className="max-w-[160px] truncate">{p.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Description</label>
                  <textarea
                    className="min-h-[96px] w-full resize-y rounded-lg border border-border/80 bg-background px-3 py-2.5 text-sm"
                    placeholder="Describe the issue, steps to reproduce, impact…"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Screenshot (optional)</label>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="text-sm file:mr-2 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
                      onChange={handleFileUpload}
                    />
                    {newScreenshot && (
                      <div className="relative">
                        <Image
                          src={newScreenshot}
                          alt="Screenshot preview"
                          width={64}
                          height={64}
                          className="h-16 w-16 rounded-lg border border-border/80 object-cover"
                          unoptimized
                        />
                        <button
                          type="button"
                          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white shadow"
                          onClick={() => {
                            setNewScreenshot(null);
                            if (fileInputRef.current) fileInputRef.current.value = "";
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 border-t border-border/60 bg-muted/10 px-6 py-4">
              <Button
                size="sm"
                className="rounded-lg"
                onClick={handleCreate}
                disabled={isPending || !newTitle.trim()}
              >
                Create issue
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-lg"
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Issues List ── */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                {showResolved ? "No issues match the filters." : "No open issues."}
              </p>
            </CardContent>
          </Card>
        )}

        {filtered.map((issue) => (
          <IssueCard key={issue.id} issue={issue} workstreams={workstreams} people={people} onUpdate={refresh} trackedSave={trackedSave} />
        ))}
      </div>
    </div>
  );
}

/* ─── Comment textarea with @ mention suggestions ────────────────────────────────── */

function CommentTextareaWithMentions({
  value,
  onChange,
  onKeyDown,
  people,
  placeholder,
  className,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  people: PersonRef[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionQuery, setMentionQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);

  const suggestions = useMemo(() => {
    if (!mentionQuery.trim()) return people.slice(0, 8);
    const q = mentionQuery.trim().toLowerCase();
    return people
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.initials?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 8);
  }, [people, mentionQuery]);

  useEffect(() => {
    if (mentionStart < 0) return;
    setHighlightIdx(0);
  }, [mentionQuery, mentionStart]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    const pos = e.target.selectionStart ?? text.length;
    onChange(text);

    let start = -1;
    for (let i = pos - 1; i >= 0; i--) {
      if (text[i] === "@") {
        const fragment = text.slice(i + 1, pos);
        if (/\s/.test(fragment)) break;
        start = i;
        setMentionStart(i);
        setMentionQuery(fragment);
        break;
      }
      if (/\s/.test(text[i])) break;
    }
    if (start < 0) {
      setMentionStart(-1);
      setMentionQuery("");
    }
  }

  function insertMention(person: PersonRef) {
    const display = person.initials || person.name;
    const before = value.slice(0, mentionStart);
    const after = value.slice(textareaRef.current?.selectionStart ?? mentionStart);
    const next = before + "@" + display + " " + after;
    onChange(next);
    setMentionStart(-1);
    setMentionQuery("");
    setTimeout(() => {
      const caret = before.length + display.length + 2;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    }, 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionStart >= 0 && suggestions.length > 0) {
      if (e.key === "Escape") {
        setMentionStart(-1);
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown") {
        setHighlightIdx((i) => (i + 1) % suggestions.length);
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowUp") {
        setHighlightIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        e.preventDefault();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        insertMention(suggestions[highlightIdx]);
        e.preventDefault();
        return;
      }
    }
    onKeyDown?.(e);
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      {mentionStart >= 0 && (
        <div
          className="absolute z-10 mt-0.5 w-56 max-h-48 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
          style={{ left: 0, top: "100%" }}
        >
          <p className="px-2 py-1 text-[10px] text-muted-foreground border-b">Type to search, Enter to pick</p>
          {suggestions.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">No matches</p>
          ) : (
            suggestions.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className={`w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-accent ${i === highlightIdx ? "bg-accent" : ""}`}
                onClick={() => insertMention(p)}
              >
                <span className="font-medium">{p.initials || p.name}</span>
                <span className="text-muted-foreground truncate">{p.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Comment block (with nested replies) ──────────────────────────────────────── */

function renderBodyWithMentions(body: string) {
  const parts = body.split(/(@\w+)/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="bg-primary/15 text-primary px-0.5 rounded font-medium">{p}</span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

function CommentBlock({
  comment,
  replies,
  isPending: parentPending,
  trackedSave,
  onUpdate,
  onReply,
}: {
  comment: IssueComment;
  replies: IssueComment[];
  isPending: boolean;
  trackedSave: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  onUpdate: () => void;
  onReply: () => void;
}) {
  const [deletePending, startTransition] = useTransition();
  const isPending = parentPending || deletePending;
  return (
    <div className="flex gap-2 group">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0 mt-0.5">
        {comment.authorName ? comment.authorName.slice(0, 2).toUpperCase() : "??"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-semibold">{comment.authorName || "Anonymous"}</span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(comment.createdAt).toLocaleString()}
          </span>
          {comment.mentions && comment.mentions.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              → @{comment.mentions.map((m) => m.person.initials || m.person.name).join(", ")}
            </span>
          )}
          <button
            type="button"
            className="text-[10px] text-primary hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
            disabled={isPending}
            onClick={(e) => { e.stopPropagation(); onReply(); }}
          >
            Reply
          </button>
          <button
            className="text-[10px] text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
            disabled={isPending}
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Delete this comment?")) {
                startTransition(async () => {
                  await trackedSave(() => deleteIssueComment(comment.id));
                  onUpdate();
                });
              }
            }}
          >
            &times;
          </button>
        </div>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-0.5">
          {renderBodyWithMentions(comment.body)}
        </p>
        {replies.length > 0 && (
          <div className="mt-2 ml-4 pl-3 border-l-2 border-muted space-y-2">
            {replies.map((r) => (
              <CommentBlock
                key={r.id}
                comment={r}
                replies={[]}
                isPending={isPending}
                trackedSave={trackedSave}
                onUpdate={onUpdate}
                onReply={onReply}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Issue Card ──────────────────────────────────────── */

function IssueCard({
  issue,
  workstreams,
  people,
  onUpdate,
  trackedSave,
}: {
  issue: OpenIssue;
  workstreams: WorkstreamRef[];
  people: PersonRef[];
  onUpdate: () => void;
  trackedSave: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(issue.title);
  const [editDesc, setEditDesc] = useState(issue.description || "");
  const [editSeverity, setEditSeverity] = useState(issue.severity);

  // Comment state
  const [commentText, setCommentText] = useState("");
  const [commentAuthor, setCommentAuthor] = useState("");
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);

  // Mention dropdown state
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredPeople = useMemo(() => {
    if (!mentionFilter) return people;
    const lower = mentionFilter.toLowerCase();
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        p.initials?.toLowerCase().includes(lower)
    );
  }, [people, mentionFilter]);

  function handleCommentKeyUp(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const textarea = e.currentTarget;
    const pos = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, pos);
    const atMatch = textBefore.match(/@([A-Za-z]*)$/);
    if (atMatch) {
      setShowMentionDropdown(true);
      setMentionFilter(atMatch[1]);
      setMentionCursorPos(pos);
    } else {
      setShowMentionDropdown(false);
      setMentionFilter("");
    }
  }

  function insertMention(person: PersonRef) {
    const textarea = commentTextareaRef.current;
    if (!textarea) return;
    const textBefore = commentText.substring(0, mentionCursorPos);
    const textAfter = commentText.substring(mentionCursorPos);
    // Find the @ position
    const atIdx = textBefore.lastIndexOf("@");
    const newText = textBefore.substring(0, atIdx) + `@${person.name} ` + textAfter;
    setCommentText(newText);
    setShowMentionDropdown(false);
    setMentionFilter("");
    // Focus back on textarea
    setTimeout(() => {
      textarea.focus();
      const newPos = atIdx + person.name.length + 2; // @name + space
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  }

  const cfg = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.NOT_A_CONCERN;
  const isResolved = !!issue.resolvedAt;
  const commentCount = issue.comments?.length || 0;
  const topLevelComments = (issue.comments || []).filter((c) => !c.parentId);
  const getReplies = (parentId: string) => (issue.comments || []).filter((c) => c.parentId === parentId);

  function handleAddComment() {
    if (!commentText.trim()) return;
    setCommentError(null);
    startTransition(async () => {
      const result = await trackedSave(() => addIssueComment({
        issueId: issue.id,
        parentId: replyingToId,
        body: commentText.trim(),
        authorName: commentAuthor.trim() || null,
      }));
      if (result && typeof result === "object" && "success" in result) {
        if (result.success) {
          setCommentText("");
          setReplyingToId(null);
          onUpdate();
        } else {
          setCommentError(result.error ?? "Save failed");
        }
      }
    });
  }

  return (
    <Card className={`transition-colors ${isResolved ? "opacity-60" : ""} ${cfg.border} border`}>
      <div
        className={`p-4 cursor-pointer hover:bg-accent/20 transition-colors ${cfg.bg}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-3">
          <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
            issue.severity === "STOPPING" ? "bg-red-500" :
            issue.severity === "SLOWING" ? "bg-yellow-500" : "bg-green-500"
          }`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className={`font-semibold truncate ${isResolved ? "line-through" : ""}`}>
                {issue.title}
              </h3>
              <Badge variant={SEVERITY_BADGE[issue.severity] || "outline"} className="text-[10px]">
                {cfg.label}
              </Badge>
              {isResolved && <Badge variant="outline" className="text-[10px] text-green-600">Resolved</Badge>}
              {commentCount > 0 && (
                <span className="text-[10px] text-muted-foreground ml-1">
                  💬 {commentCount}
                </span>
              )}
            </div>
            <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
              <span>
                Workstream: <strong className="text-foreground">{issue.workstream.name}</strong>
              </span>
              {issue.subTask && (
                <span>
                  Blocks: <strong className="text-foreground">{issue.subTask.name}</strong>
                  {issue.subTask.initiative && (
                    <span className="text-muted-foreground"> ({issue.subTask.initiative.name})</span>
                  )}
                </span>
              )}
              <span>
                Assigned: <strong className="text-foreground">
                  {(issue.assignees ?? []).length > 0
                    ? (issue.assignees ?? []).map((a) => a.person.initials ? `${a.person.initials} (${a.person.name})` : a.person.name).join(", ")
                    : "—"}
                </strong>
              </span>
              <span>{new Date(issue.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{expanded ? "−" : "+"}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t p-4 space-y-4 bg-background">
          {/* Assignees (multi) */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Assigned to</label>
            <div className="flex flex-wrap gap-2 items-center">
              {(issue.assignees ?? []).map((a) => (
                <Badge key={a.person.id} variant="secondary" className="text-[10px]">
                  {a.person.initials ? `${a.person.initials} (${a.person.name})` : a.person.name}
                  <button
                    type="button"
                    className="ml-1 opacity-70 hover:opacity-100"
                    disabled={isPending}
                    onClick={() => {
                      const next = (issue.assignees ?? []).filter((x) => x.person.id !== a.person.id).map((x) => x.person.id);
                      startTransition(async () => {
                        await trackedSave(() => setIssueAssignees(issue.id, next));
                        onUpdate();
                      });
                    }}
                  >
                    ×
                  </button>
                </Badge>
              ))}
              <select
                className="rounded-md border px-2 py-1 text-xs bg-background"
                value=""
                onChange={(e) => {
                  const personId = e.target.value;
                  e.target.value = "";
                  if (!personId) return;
                  const currentIds = (issue.assignees ?? []).map((a) => a.person.id);
                  if (currentIds.includes(personId)) return;
                  startTransition(async () => {
                    await trackedSave(() => setIssueAssignees(issue.id, [...currentIds, personId]));
                    onUpdate();
                  });
                }}
              >
                <option value="">+ Add assignee</option>
                {people.filter((p) => !(issue.assignees ?? []).some((a) => a.person.id === p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.initials ? `${p.initials} — ${p.name}` : p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          {issue.description && !editing && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{issue.description}</p>
          )}

          {/* Screenshot */}
          {issue.screenshotUrl && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Screenshot</p>
              <Image
                src={issue.screenshotUrl}
                alt="Issue screenshot"
                width={400}
                height={256}
                className="max-h-64 w-auto rounded-lg border cursor-pointer"
                onClick={() => window.open(issue.screenshotUrl!, "_blank")}
                unoptimized
              />
            </div>
          )}

          {/* Edit form */}
          {editing && (
            <div className="space-y-3 border rounded-lg p-3 bg-muted/20">
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1">Title</label>
                <Input
                  className="h-8 text-sm"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1">Description</label>
                <textarea
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background min-h-[60px] resize-y"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1">Severity</label>
                <select
                  className="rounded-md border px-3 py-1.5 text-sm bg-background w-full"
                  value={editSeverity}
                  onChange={(e) => setEditSeverity(e.target.value)}
                >
                  <option value="STOPPING">Stopping</option>
                  <option value="SLOWING">Slowing</option>
                  <option value="NOT_A_CONCERN">Not a concern</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="text-xs"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(async () => {
                      await trackedSave(() => updateOpenIssue(issue.id, {
                        title: editTitle.trim(),
                        description: editDesc.trim() || null,
                        severity: editSeverity,
                      }));
                      setEditing(false);
                      onUpdate();
                    });
                  }}
                >
                  Save
                </Button>
                <Button size="sm" variant="ghost" className="text-xs" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* ── Comment Thread (cascading) ── */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              💬 Comments {commentCount > 0 && <span>({commentCount})</span>}
            </h4>

            {topLevelComments.length > 0 ? (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {topLevelComments.map((c) => (
                  <CommentBlock
                    key={c.id}
                    comment={c}
                    replies={getReplies(c.id)}
                    isPending={isPending}
                    trackedSave={trackedSave}
                    onUpdate={onUpdate}
                    onReply={() => setReplyingToId(c.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No comments yet.</p>
            )}

            {replyingToId && (
              <p className="text-[10px] text-primary">Replying to comment — your message will be nested below it.</p>
            )}

            {/* Add comment form */}
            <div className="flex gap-2 items-start pt-1 border-t">
              <div className="flex-1 space-y-1.5">
                <div className="flex gap-2">
                  <Input
                    className="h-7 text-xs flex-1"
                    placeholder="Your name (optional)"
                    value={commentAuthor}
                    onChange={(e) => setCommentAuthor(e.target.value)}
                  />
                  {replyingToId && (
                    <Button type="button" variant="ghost" size="sm" className="text-[10px] h-7" onClick={() => setReplyingToId(null)}>
                      Cancel reply
                    </Button>
                  )}
                </div>
                <CommentTextareaWithMentions
                  className="w-full rounded-md border px-2.5 py-1.5 text-sm bg-background min-h-[50px] resize-y"
                  placeholder="Add a comment... Type @ for suggestions to notify someone."
                  value={commentText}
                  onChange={(v) => { setCommentText(v); setCommentError(null); }}
                  people={people}
                  disabled={isPending}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      handleAddComment();
                    }
                  }}
                />
                {commentError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{commentError}</p>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="text-xs h-7"
                    disabled={isPending || !commentText.trim()}
                    onClick={handleAddComment}
                  >
                    Post Comment
                  </Button>
                  <span className="text-[10px] text-muted-foreground">Ctrl+Enter to submit · Type @ to mention</span>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 flex-wrap border-t pt-3">
            {!editing && (
              <Button size="sm" variant="outline" className="text-[10px] h-6 px-2" onClick={() => setEditing(true)}>
                ✏️ Edit
              </Button>
            )}
            {!isResolved ? (
              <Button
                size="sm"
                variant="outline"
                className="text-[10px] h-6 px-2 text-green-600"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    await trackedSave(() => resolveOpenIssue(issue.id));
                    onUpdate();
                  });
                }}
              >
                ✓ Resolve
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="text-[10px] h-6 px-2"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    await trackedSave(() => reopenIssue(issue.id));
                    onUpdate();
                  });
                }}
              >
                ↻ Reopen
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-[10px] h-6 px-2 text-red-500 hover:text-red-700"
              disabled={isPending}
              onClick={() => {
                if (confirm("Delete this issue?")) {
                  startTransition(async () => {
                    await trackedSave(() => deleteOpenIssue(issue.id));
                    onUpdate();
                  });
                }
              }}
            >
              🗑 Delete
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

