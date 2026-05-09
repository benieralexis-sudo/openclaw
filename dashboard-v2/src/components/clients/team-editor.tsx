"use client";

/**
 * Sprint 5 (10/05/2026) — Editor equipe (users) par client.
 *
 * Liste les users rattaches au client + bouton "Inviter" qui :
 *   1. Cree le user via POST /api/users (admin only — backend valide)
 *   2. Affiche le mot de passe temporaire UNE SEULE FOIS pour copy-paste
 *   3. L'admin transmet le mdp au user manuellement (WhatsApp/Slack/etc.)
 *
 * Roles autorises : EDITOR, VIEWER (pour invite via cette UI).
 * ADMIN peut inviter via SQL direct (cas exceptionnel).
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Copy, X, Loader2, AlertCircle, CheckCircle2, Mail, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "COMMERCIAL" | "CLIENT" | "EDITOR" | "VIEWER";
  clientId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  onboardingDone: boolean;
}

interface InviteResponse {
  id: string;
  email: string;
  name: string;
  role: string;
  clientId: string | null;
  createdAt: string;
  tempPassword: string;
}

const ROLE_LABEL: Record<string, { label: string; color: string }> = {
  ADMIN: { label: "Admin", color: "bg-purple-100 text-purple-700" },
  COMMERCIAL: { label: "Commercial", color: "bg-blue-100 text-blue-700" },
  CLIENT: { label: "Client", color: "bg-emerald-100 text-emerald-700" },
  EDITOR: { label: "Editor", color: "bg-amber-100 text-amber-700" },
  VIEWER: { label: "Viewer", color: "bg-ink-100 text-ink-700" },
};

export function TeamEditor({ clientId, canInvite }: { clientId: string; canInvite: boolean }) {
  const queryClient = useQueryClient();
  const { data: users = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["team-users", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/users?clientId=${clientId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteData, setInviteData] = useState({
    email: "",
    name: "",
    role: "EDITOR" as TeamMember["role"],
  });
  const [createdUser, setCreatedUser] = useState<InviteResponse | null>(null);

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteData.email,
          name: inviteData.name,
          role: inviteData.role,
          clientId,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<InviteResponse>;
    },
    onSuccess: (created) => {
      setCreatedUser(created);
      setShowInviteForm(false);
      setInviteData({ email: "", name: "", role: "EDITOR" });
      queryClient.invalidateQueries({ queryKey: ["team-users", clientId] });
    },
  });

  if (isLoading)
    return (
      <div className="p-6 text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
        Chargement…
      </div>
    );

  return (
    <div className="space-y-4">
      {/* Header avec bouton invite */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base">{users.length} membre{users.length !== 1 ? "s" : ""}</h3>
          <p className="text-sm text-ink-600">Personnes ayant accès à ce client.</p>
        </div>
        {canInvite && !showInviteForm && (
          <Button onClick={() => setShowInviteForm(true)} size="sm" className="gap-1.5">
            <UserPlus className="h-4 w-4" />
            Inviter
          </Button>
        )}
      </div>

      {/* Modal mdp temporaire affiche apres creation */}
      {createdUser && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
              <div>
                <div className="font-semibold text-green-800">User créé !</div>
                <div className="text-sm text-green-700 mt-1">
                  <strong>{createdUser.name}</strong> ({createdUser.email}) — rôle {createdUser.role}
                </div>
              </div>
            </div>
            <button
              onClick={() => setCreatedUser(null)}
              className="text-green-700 hover:text-green-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="rounded-md bg-white border border-green-200 p-3">
            <Label className="text-xs text-ink-600 mb-1 block">
              ⚠️ Mot de passe temporaire (visible une SEULE fois) :
            </Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-ink-100 rounded text-sm font-mono select-all">
                {createdUser.tempPassword}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigator.clipboard.writeText(createdUser.tempPassword)}
              >
                <Copy className="h-3.5 w-3.5 mr-1" />
                Copier
              </Button>
            </div>
            <p className="text-xs text-ink-600 mt-2">
              📨 Transmets ce mot de passe au user manuellement (WhatsApp, Slack, email perso). Il pourra
              ensuite changer son mdp dans son profil.
            </p>
          </div>
        </div>
      )}

      {/* Form invite */}
      {showInviteForm && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-blue-600" />
              Inviter un membre
            </div>
            <button onClick={() => setShowInviteForm(false)} className="text-ink-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteData.email}
                onChange={(e) => setInviteData({ ...inviteData, email: e.target.value })}
                placeholder="ex: marie@acmecorp.fr"
              />
            </div>
            <div>
              <Label htmlFor="invite-name">Nom</Label>
              <Input
                id="invite-name"
                value={inviteData.name}
                onChange={(e) => setInviteData({ ...inviteData, name: e.target.value })}
                placeholder="ex: Marie Dupont"
              />
            </div>
            <div>
              <Label htmlFor="invite-role">Rôle</Label>
              <select
                id="invite-role"
                value={inviteData.role}
                onChange={(e) => setInviteData({ ...inviteData, role: e.target.value as TeamMember["role"] })}
                className="w-full h-9 px-3 rounded-md border border-ink-200 bg-white text-sm"
              >
                <option value="EDITOR">EDITOR — peut configurer ICP/delivery</option>
                <option value="VIEWER">VIEWER — lecture seule</option>
                <option value="CLIENT">CLIENT — comme EDITOR (legacy)</option>
              </select>
            </div>
          </div>
          {inviteMutation.error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {String(inviteMutation.error)}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowInviteForm(false)}>
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={() => inviteMutation.mutate()}
              disabled={
                inviteMutation.isPending ||
                !inviteData.email ||
                !inviteData.name
              }
            >
              {inviteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Créer le user
            </Button>
          </div>
        </div>
      )}

      {/* Liste users */}
      <div className="rounded-lg border border-ink-200 bg-white divide-y divide-ink-100">
        {users.length === 0 ? (
          <div className="p-6 text-center text-ink-500 text-sm">
            Aucun membre rattaché à ce client.
            {canInvite && <span className="block mt-2">Clique sur "Inviter" pour commencer.</span>}
          </div>
        ) : (
          users.map((u) => (
            <div key={u.id} className="px-4 py-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold text-sm">
                {(u.name || u.email).slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-ink-900 truncate">{u.name || u.email}</div>
                <div className="text-xs text-ink-600 flex items-center gap-1.5 mt-0.5">
                  <Mail className="h-3 w-3" />
                  {u.email}
                </div>
              </div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${ROLE_LABEL[u.role]?.color ?? "bg-ink-100 text-ink-700"}`}>
                <Shield className="h-3 w-3" />
                {ROLE_LABEL[u.role]?.label ?? u.role}
              </span>
              {u.lastLoginAt ? (
                <span className="text-xs text-ink-500" title={u.lastLoginAt}>
                  Actif
                </span>
              ) : (
                <span className="text-xs text-amber-600" title="Pas encore connecté">
                  Pending
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
