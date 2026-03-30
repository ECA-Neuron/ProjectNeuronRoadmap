"use client";

import { useState, useTransition, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addIssueComment, deleteIssueComment } from "@/lib/actions/open-issues";
import { useTrackedSave } from "@/hooks/use-autosave";
import { useRole } from "@/hooks/use-role";

/* ─── Types ───────────────────────────────────────────── */

interface IssueComment {
  id: string;
  parentId: string | null;
  body: string;
  authorName: string | null;
  createdAt: string;
  mentions?: { person: { id: string; name: string; initials: string | null } }[];
}

interface DashboardIssue {
  id: string;
  title: string;
  severity: string;
  createdAt?: string;
  workstream: { id?: string; name: string } | null;
  subTask: { id?: string; name: string } | null;
  assignees?: { person: { id: string; name: string; initials: string | null } }[];
  comments: IssueComment[];
}

interface PersonRef {
  id: string;
  name: string;
  initials: string | null;
}

interface SeenEntry {
  issueId: string;
  lastSeenAt: string;
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
          className="absolute z-[100] mt-0.5 w-56 max-h-48 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
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

/* ─── Dashboard issue row (expandable, with comments) ────────────────────────────── */

function DashboardIssueRow({
  issue,
  people,
  hasNewReply,
  onUpdate,
  trackedSave,
}: {
  issue: DashboardIssue;
  people: PersonRef[];
  hasNewReply: boolean;
  onUpdate: () => void;
  trackedSave: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [commentText, setCommentText] = useState("");
  const [commentAuthor, setCommentAuthor] = useState("");
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);

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
    <div className="border rounded-lg overflow-visible">
      <button
        type="button"
        className={`w-full text-left p-3 hover:bg-accent/30 transition-colors flex items-center gap-2 flex-wrap ${hasNewReply ? "border-l-4 border-l-orange-400 bg-orange-50/50 dark:bg-orange-950/20" : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${issue.severity === "STOPPING" ? "bg-red-500" : issue.severity === "SLOWING" ? "bg-yellow-500" : "bg-green-500"}`} />
        <span className="font-medium text-sm">{issue.title}</span>
        <Badge variant={issue.severity === "STOPPING" ? "destructive" : issue.severity === "SLOWING" ? "secondary" : "outline"} className="text-[9px] shrink-0">
          {issue.severity === "STOPPING" ? "Stopping" : issue.severity === "SLOWING" ? "Slowing" : "Not a concern"}
        </Badge>
        {hasNewReply && <Badge variant="destructive" className="text-[9px]">New reply</Badge>}
        {commentCount > 0 && (
          <span className="text-[10px] text-muted-foreground ml-1">💬 {commentCount}</span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{expanded ? "−" : "+"}</span>
      </button>
      <div className="text-[10px] text-muted-foreground px-3 pb-2 pt-0">
        {issue.workstream?.name} {issue.subTask && `· ${issue.subTask.name}`}
      </div>

      {expanded && (
        <div className="border-t p-4 space-y-3 bg-muted/20 overflow-visible">
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

          <div className="flex gap-2 items-start pt-1 border-t overflow-visible">
            <div className="flex-1 space-y-1.5 min-w-0 overflow-visible">
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

          <p className="text-[10px] text-muted-foreground pt-1">
            <Link href="/open-issues" className="text-primary underline">Open full issue in Open Issues tab</Link> to edit, assign, or resolve.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Main export ─────────────────────────────────────── */

export function DashboardOpenIssues({
  issues = [],
  people = [],
  seen = [],
}: {
  issues?: DashboardIssue[] | null;
  people?: PersonRef[] | null;
  seen?: SeenEntry[] | null;
}) {
  const router = useRouter();
  const trackedSave = useTrackedSave();
  const { canEdit } = useRole();

  function onUpdate() {
    router.refresh();
  }

  const safeIssues = useMemo(() => (Array.isArray(issues) ? issues : []), [issues]);
  const safePeople = useMemo(() => (Array.isArray(people) ? people : []), [people]);
  const safeSeen = useMemo(() => (Array.isArray(seen) ? seen : []), [seen]);
  const seenMap = useMemo(() => new Map(safeSeen.map((s) => [s.issueId, s.lastSeenAt])), [safeSeen]);

  return (
    <div className="space-y-2">
      {safeIssues.map((issue) => {
        const lastSeen = seenMap.get(issue.id);
        const hasNewReply =
          issue.comments?.length > 0 &&
          (!lastSeen || new Date(issue.comments[issue.comments.length - 1].createdAt) > new Date(lastSeen));

        return (
          <DashboardIssueRow
            key={issue.id}
            issue={issue}
            people={safePeople}
            hasNewReply={!!hasNewReply}
            onUpdate={onUpdate}
            trackedSave={trackedSave}
          />
        );
      })}
    </div>
  );
}
