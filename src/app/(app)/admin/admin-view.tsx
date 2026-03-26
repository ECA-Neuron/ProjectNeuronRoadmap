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

export function AdminView({
  users: initialUsers,
  people: initialPeople,
  refinementInitiatives,
}: {
  users: User[];
  people: PersonRef[];
  refinementInitiatives: RefinementInit[];
}) {
  const [users, setUsers] = useState(initialUsers);
  const [people, setPeople] = useState(initialPeople);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("MEMBER");

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Admin</h1>
        <p className="text-muted-foreground mt-1">User management &amp; date refinement</p>
      </div>

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
