"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createUser, updateUserRole, deleteUser, linkPersonToUser } from "@/lib/actions/admin";
import { updateInitiativeDates } from "@/lib/actions/initiatives";

interface User {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  createdAt: string;
}

interface PersonRef {
  id: string;
  name: string;
  initials: string | null;
  userId: string | null;
}

interface RefinementInit {
  id: string;
  name: string;
  plannedStartMonth?: string | null;
  plannedEndMonth?: string | null;
  workstream: { name: string };
}

interface SyncLogEntry {
  id: string;
  syncType: string;
  direction: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  itemsSynced: number;
  errors: string | null;
}

export function AdminView({
  users: initialUsers,
  people: initialPeople,
  refinementInitiatives,
  recentSyncs: initialSyncs,
}: {
  users: User[];
  people: PersonRef[];
  refinementInitiatives: RefinementInit[];
  recentSyncs: SyncLogEntry[];
}) {
  const [users, setUsers] = useState(initialUsers);
  const [people, setPeople] = useState(initialPeople);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [syncs, setSyncs] = useState(initialSyncs);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    pulled?: number;
    pushed?: number;
    errors?: string[];
    error?: string;
  } | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<{
    success: boolean;
    output?: string;
    error?: string;
  } | null>(null);

  const handleAddUser = async () => {
    if (!email) return;
    await createUser({ email, name, role });
    setEmail("");
    setName("");
    window.location.reload();
  };

  const handleRoleChange = async (id: string, newRole: string) => {
    await updateUserRole(id, newRole);
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role: newRole } : u)));
  };

  const handleDeleteUser = async (id: string, email: string) => {
    if (!confirm(`Are you sure you want to delete ${email}?`)) return;
    await deleteUser(id);
    setUsers((prev) => prev.filter((u) => u.id !== id));
  };

  const handleLinkPerson = async (userId: string, personId: string | null) => {
    await linkPersonToUser(userId, personId);
    // Update local state: unlink old person from this user, link new one
    setPeople((prev) =>
      prev.map((p) => {
        if (p.userId === userId) return { ...p, userId: null };
        if (p.id === personId) return { ...p, userId };
        return p;
      })
    );
  };

  const handleRefineDate = async (id: string, start: string, end: string) => {
    await updateInitiativeDates(id, start || null, end || null);
    window.location.reload();
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncType: "MANUAL" }),
      });
      const data = await res.json();
      setSyncResult(data);
      if (data.success) {
        const logsRes = await fetch("/api/sync");
        const logsData = await logsRes.json();
        if (logsData.logs) setSyncs(logsData.logs);
      }
    } catch (err) {
      setSyncResult({
        success: false,
        error: err instanceof Error ? err.message : "Sync failed",
      });
    } finally {
      setSyncing(false);
    }
  };

  const [notionStatus, setNotionStatus] = useState<{
    loading: boolean;
    data: null | {
      accessibleDatabases: { id: string; title: string }[];
      requiredChecks: { name: string; found: boolean; dbTitle: string | null }[];
      allConnected: boolean;
    };
    error: string | null;
  }>({ loading: false, data: null, error: null });

  const checkNotionConnection = async () => {
    setNotionStatus({ loading: true, data: null, error: null });
    try {
      const res = await fetch("/api/debug/notion-status");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to check");
      setNotionStatus({ loading: false, data, error: null });
    } catch (err) {
      setNotionStatus({ loading: false, data: null, error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-muted-foreground mt-1">User management, Notion sync &amp; date refinement</p>
      </div>

      {/* Notion Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Notion Connection Status</span>
            <Button onClick={checkNotionConnection} disabled={notionStatus.loading} variant="outline" size="sm">
              {notionStatus.loading ? "Checking..." : "Check Connection"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!notionStatus.data && !notionStatus.error && !notionStatus.loading && (
            <p className="text-sm text-muted-foreground">Click "Check Connection" to see which Notion databases are accessible.</p>
          )}
          {notionStatus.error && (
            <p className="text-sm text-red-600">{notionStatus.error}</p>
          )}
          {notionStatus.data && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold mb-2">Required Databases</h4>
                <div className="space-y-1">
                  {notionStatus.data.requiredChecks.map((c) => (
                    <div key={c.name} className="flex items-center gap-2 text-sm">
                      <span className={`w-2 h-2 rounded-full ${c.found ? "bg-green-500" : "bg-red-500"}`} />
                      <span className={c.found ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
                        {c.name}
                      </span>
                      {c.found && c.dbTitle && <span className="text-muted-foreground">→ "{c.dbTitle}"</span>}
                      {!c.found && <span className="text-red-500 text-xs">(not accessible — re-authorize Notion and select this database)</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-2">All Accessible Databases ({notionStatus.data.accessibleDatabases.length})</h4>
                {notionStatus.data.accessibleDatabases.length === 0 ? (
                  <p className="text-sm text-red-600">No databases accessible. Sign out and sign back in via Notion, making sure to select all databases on the authorization screen.</p>
                ) : (
                  <ul className="text-xs text-muted-foreground space-y-0.5">
                    {notionStatus.data.accessibleDatabases.map((db) => (
                      <li key={db.id}>"{db.title || "(untitled)"}" <span className="opacity-50">({db.id})</span></li>
                    ))}
                  </ul>
                )}
              </div>
              {!notionStatus.data.allConnected && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                  <p className="font-semibold">How to fix:</p>
                  <ol className="list-decimal pl-4 space-y-0.5">
                    <li>Sign out of this app</li>
                    <li>Click "Sign in with Notion"</li>
                    <li>On the Notion authorization page, click <strong>"Select pages"</strong></li>
                    <li>Check <strong>all three databases</strong>: Neuron Workstreams Roadmap, Roadmap Progress Log, and 🔴 Open Issues</li>
                    <li>Click "Allow access"</li>
                  </ol>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Database Migration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Database Schema</span>
            <Button
              onClick={async () => {
                setMigrating(true);
                setMigrateResult(null);
                try {
                  const res = await fetch("/api/migrate", { method: "POST" });
                  const data = await res.json();
                  setMigrateResult(data);
                } catch (err) {
                  setMigrateResult({
                    success: false,
                    error: err instanceof Error ? err.message : "Migration failed",
                  });
                } finally {
                  setMigrating(false);
                }
              }}
              disabled={migrating}
              size="sm"
              variant="outline"
            >
              {migrating ? "Migrating..." : "Push Schema"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Applies pending Prisma schema changes to the production database.
            Run this once after deploying schema updates.
          </p>
          {migrateResult && (
            <div
              className={`rounded-md p-3 text-sm ${
                migrateResult.success
                  ? "bg-green-50 text-green-800 border border-green-200"
                  : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              {migrateResult.success ? (
                <p className="font-medium">Schema updated successfully. Reload the page.</p>
              ) : (
                <p>{migrateResult.error ?? "Migration failed"}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notion Sync */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Notion Sync</span>
            <Button onClick={handleSync} disabled={syncing} size="sm">
              {syncing ? "Syncing..." : "Sync Now"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {syncResult && (
            <div
              className={`mb-4 rounded-md p-3 text-sm ${
                syncResult.success
                  ? "bg-green-50 text-green-800 border border-green-200"
                  : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              {syncResult.success ? (
                <>
                  <p className="font-medium">Sync completed</p>
                  <p>Pulled {syncResult.pulled ?? 0} items from Notion, pushed {syncResult.pushed ?? 0} items back.</p>
                  {syncResult.errors && syncResult.errors.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium">
                        {syncResult.errors.length} warning(s)
                      </summary>
                      <ul className="mt-1 list-disc pl-4 text-xs">
                        {syncResult.errors.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              ) : (
                <p>{syncResult.error ?? "Sync failed"}</p>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground mb-3">
            Two-way sync with the &ldquo;Neuron Workstreams Roadmap&rdquo; Notion database.
            Pulls new data from Notion and pushes dashboard changes back.
          </p>

          {syncs.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-1.5">Time</th>
                  <th className="text-left p-1.5">Type</th>
                  <th className="text-left p-1.5">Status</th>
                  <th className="text-left p-1.5">Items</th>
                </tr>
              </thead>
              <tbody>
                {syncs.map((s) => (
                  <tr key={s.id} className="border-b">
                    <td className="p-1.5">{new Date(s.startedAt).toLocaleString()}</td>
                    <td className="p-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {s.syncType}
                      </Badge>
                    </td>
                    <td className="p-1.5">
                      <Badge
                        variant={s.status === "SUCCESS" ? "default" : s.status === "FAILED" ? "destructive" : "secondary"}
                        className="text-[10px]"
                      >
                        {s.status}
                      </Badge>
                    </td>
                    <td className="p-1.5">{s.itemsSynced}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Add user */}
      <Card>
        <CardHeader><CardTitle>Add User</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="text-xs font-medium">Email *</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} className="w-48" />
            </div>
            <div>
              <label className="text-xs font-medium">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="w-40" />
            </div>
            <div>
              <label className="text-xs font-medium">Role</label>
              <select className="rounded-md border px-3 py-2 text-sm bg-background" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="VIEWER">Viewer</option>
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <Button onClick={handleAddUser}>Add</Button>
          </div>
        </CardContent>
      </Card>

      {/* Users table */}
      <Card>
        <CardHeader><CardTitle>Users ({users.length})</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Email</th>
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Linked Person</th>
                <th className="text-left p-2">Role</th>
                <th className="text-left p-2">Created</th>
                <th className="text-left p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const linkedPerson = people.find((p) => p.userId === u.id);
                return (
                  <tr key={u.id} className="border-b">
                    <td className="p-2">{u.email}</td>
                    <td className="p-2">{u.name || "—"}</td>
                    <td className="p-2">
                      <select
                        className="rounded border px-2 py-1 text-xs bg-background w-44"
                        value={linkedPerson?.id || "__none"}
                        onChange={(e) => {
                          const val = e.target.value;
                          handleLinkPerson(u.id, val === "__none" ? null : val);
                        }}
                      >
                        <option value="__none">— Not linked —</option>
                        {people.map((p) => {
                          const taken = p.userId && p.userId !== u.id;
                          return (
                            <option key={p.id} value={p.id} disabled={!!taken}>
                              {p.name}{p.initials ? ` (${p.initials})` : ""}{taken ? " [linked]" : ""}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                    <td className="p-2">
                      <select
                        className="rounded border px-2 py-1 text-xs bg-background"
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      >
                        <option value="VIEWER">Viewer</option>
                        <option value="MEMBER">Member</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="p-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[10px] h-6 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleDeleteUser(u.id, u.email)}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Refine Dates */}
      {refinementInitiatives.length > 0 && (
        <Card>
          <CardHeader><CardTitle>⚠️ Initiatives Needing Date Refinement</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              These initiatives have approximate dates from the initial roadmap. Edit start/end months below.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Initiative</th>
                  <th className="text-left p-2">Workstream</th>
                  <th className="text-left p-2">Start (YYYY-MM)</th>
                  <th className="text-left p-2">End (YYYY-MM)</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {refinementInitiatives.map((i) => (
                  <RefineRow key={i.id} init={i} onSave={handleRefineDate} />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RefineRow({
  init,
  onSave,
}: {
  init: RefinementInit;
  onSave: (id: string, start: string, end: string) => void;
}) {
  const [start, setStart] = useState(init.plannedStartMonth || "");
  const [end, setEnd] = useState(init.plannedEndMonth || "");

  return (
    <tr className="border-b">
      <td className="p-2 font-medium">{init.name}</td>
      <td className="p-2 text-xs">{init.workstream.name}</td>
      <td className="p-2"><Input value={start} onChange={(e) => setStart(e.target.value)} className="w-28" placeholder="YYYY-MM" /></td>
      <td className="p-2"><Input value={end} onChange={(e) => setEnd(e.target.value)} className="w-28" placeholder="YYYY-MM" /></td>
      <td className="p-2"><Button size="sm" onClick={() => onSave(init.id, start, end)}>Save</Button></td>
    </tr>
  );
}
