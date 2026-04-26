"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  Copy,
  Mail,
  Plug,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { useScope } from "@/hooks/use-scope";
import { cn, formatRelativeFr } from "@/lib/utils";

type Role = "ADMIN" | "COMMERCIAL" | "CLIENT" | "EDITOR" | "VIEWER";

interface Preferences {
  digestWeekly?: boolean;
  alertHotTrigger?: boolean;
  alertNewReply?: boolean;
  alertMeetingBooked?: boolean;
  digestDay?: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  digestHour?: number;
}

interface MeFull {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  clientId: string | null;
  scopeClientIds: string[];
  onboardingDone: boolean;
  locale: string;
  timezone: string;
  preferences: Preferences | null;
}

interface TeamUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  clientId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  onboardingDone: boolean;
}

const ROLE_META: Record<Role, { label: string; variant: "default" | "info" | "brand" | "success" | "fire" }> = {
  ADMIN: { label: "Admin", variant: "fire" },
  COMMERCIAL: { label: "Commercial", variant: "brand" },
  CLIENT: { label: "Propriétaire", variant: "success" },
  EDITOR: { label: "Éditeur", variant: "info" },
  VIEWER: { label: "Lecture seule", variant: "default" },
};

const DEFAULT_PREFS: Required<Preferences> = {
  digestWeekly: true,
  alertHotTrigger: true,
  alertNewReply: true,
  alertMeetingBooked: true,
  digestDay: "mon",
  digestHour: 8,
};

export function SettingsBoard() {
  const queryClient = useQueryClient();
  useScope(); // garde le hook pour syncer le cache me global

  const { data: me, isLoading } = useQuery<MeFull>({
    queryKey: ["me-full"],
    queryFn: async () => {
      const res = await fetch("/api/me");
      if (!res.ok) throw new Error("Erreur chargement profil");
      return res.json();
    },
  });

  if (isLoading || !me) {
    return <SettingsSkeleton />;
  }

  const canManageTeam =
    me.role === "ADMIN" || me.role === "EDITOR" || me.role === "CLIENT";

  return (
    <Tabs defaultValue="prefs" className="space-y-4">
      <TabsList className="bg-white border border-ink-200 shadow-xs">
        <TabsTrigger value="prefs" className="gap-1.5">
          <Bell className="h-3.5 w-3.5" />
          Préférences
        </TabsTrigger>
        {canManageTeam && (
          <TabsTrigger value="team" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Équipe
          </TabsTrigger>
        )}
        <TabsTrigger value="integrations" className="gap-1.5">
          <Plug className="h-3.5 w-3.5" />
          Intégrations
        </TabsTrigger>
      </TabsList>

      <TabsContent value="prefs">
        <PrefsPanel
          me={me}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["me-full"] });
            queryClient.invalidateQueries({ queryKey: ["me"] });
          }}
        />
      </TabsContent>

      {canManageTeam && (
        <TabsContent value="team">
          <TeamPanel
            currentRole={me.role}
            currentUserId={me.id}
            clientId={me.clientId}
          />
        </TabsContent>
      )}

      <TabsContent value="integrations">
        <IntegrationsPanel />
      </TabsContent>
    </Tabs>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Préférences (locale, timezone, notifications)
// ──────────────────────────────────────────────────────────────────────

const LOCALES = [
  { value: "fr-FR", label: "Français (France)" },
  { value: "en-US", label: "English (US)" },
];

const TIMEZONES = [
  "Europe/Paris",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

const DAYS = [
  { value: "mon", label: "Lundi" },
  { value: "tue", label: "Mardi" },
  { value: "wed", label: "Mercredi" },
  { value: "thu", label: "Jeudi" },
  { value: "fri", label: "Vendredi" },
  { value: "sat", label: "Samedi" },
  { value: "sun", label: "Dimanche" },
] as const;

function PrefsPanel({ me, onSaved }: { me: MeFull; onSaved: () => void }) {
  const [name, setName] = React.useState(me.name ?? "");
  const [locale, setLocale] = React.useState(me.locale);
  const [timezone, setTimezone] = React.useState(me.timezone);
  const [prefs, setPrefs] = React.useState<Required<Preferences>>({
    ...DEFAULT_PREFS,
    ...(me.preferences ?? {}),
  });

  React.useEffect(() => {
    setName(me.name ?? "");
    setLocale(me.locale);
    setTimezone(me.timezone);
    setPrefs({ ...DEFAULT_PREFS, ...(me.preferences ?? {}) });
  }, [me]);

  const isDirty =
    name !== (me.name ?? "") ||
    locale !== me.locale ||
    timezone !== me.timezone ||
    JSON.stringify(prefs) !== JSON.stringify({ ...DEFAULT_PREFS, ...(me.preferences ?? {}) });

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, locale, timezone, preferences: prefs }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Erreur enregistrement");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Préférences enregistrées");
      onSaved();
    },
    onError: (err: Error) => {
      toast.error("Échec", { description: err.message });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
              Profil
            </h3>
            <p className="mt-0.5 text-[12px] text-ink-500">
              Vos infos personnelles et préférences régionales.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="name">Nom complet</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alexis Bénier"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                value={me.email}
                disabled
                className="mt-1.5 font-mono text-[12.5px]"
              />
            </div>
            <div>
              <Label htmlFor="locale">Langue</Label>
              <select
                id="locale"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-md border border-ink-200 bg-white px-3 text-[13px] text-ink-800 shadow-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              >
                {LOCALES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="tz">Fuseau horaire</Label>
              <select
                id="tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-md border border-ink-200 bg-white px-3 text-[13px] text-ink-800 shadow-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
              Notifications
            </h3>
            <p className="mt-0.5 text-[12px] text-ink-500">
              Choisissez ce qui mérite de vous interrompre.
            </p>
          </div>

          <ToggleRow
            title="Alertes pépites (score ≥ 9)"
            description="Email immédiat dès qu'un trigger très chaud est détecté"
            checked={prefs.alertHotTrigger}
            onChange={(v) => setPrefs({ ...prefs, alertHotTrigger: v })}
          />
          <ToggleRow
            title="Réponses positives"
            description="Email à chaque reply classé POSITIVE_INTEREST"
            checked={prefs.alertNewReply}
            onChange={(v) => setPrefs({ ...prefs, alertNewReply: v })}
          />
          <ToggleRow
            title="RDV bookés"
            description="Email + ICS quand un MEETING_SET est ajouté"
            checked={prefs.alertMeetingBooked}
            onChange={(v) => setPrefs({ ...prefs, alertMeetingBooked: v })}
          />
          <ToggleRow
            title="Digest hebdomadaire"
            description="Récap pipeline + KPIs envoyé chaque semaine"
            checked={prefs.digestWeekly}
            onChange={(v) => setPrefs({ ...prefs, digestWeekly: v })}
          />

          {prefs.digestWeekly && (
            <div className="grid grid-cols-2 gap-3 rounded-md border border-ink-100 bg-ink-50/40 p-3">
              <div>
                <Label htmlFor="digestDay" className="text-[11.5px]">
                  Jour d'envoi
                </Label>
                <select
                  id="digestDay"
                  value={prefs.digestDay}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      digestDay: e.target.value as Required<Preferences>["digestDay"],
                    })
                  }
                  className="mt-1 h-8 w-full rounded-md border border-ink-200 bg-white px-2 text-[12.5px] text-ink-800 shadow-xs"
                >
                  {DAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="digestHour" className="text-[11.5px]">
                  Heure (24h)
                </Label>
                <select
                  id="digestHour"
                  value={prefs.digestHour}
                  onChange={(e) =>
                    setPrefs({ ...prefs, digestHour: Number(e.target.value) })
                  }
                  className="mt-1 h-8 w-full rounded-md border border-ink-200 bg-white px-2 text-[12.5px] text-ink-800 shadow-xs"
                >
                  {Array.from({ length: 24 }).map((_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}h00
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={!isDirty || save.isPending}
          onClick={() => {
            setName(me.name ?? "");
            setLocale(me.locale);
            setTimezone(me.timezone);
            setPrefs({ ...DEFAULT_PREFS, ...(me.preferences ?? {}) });
          }}>
          Annuler
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={!isDirty || save.isPending}
          onClick={() => save.mutate()}
          className="gap-1.5"
        >
          <Check className="h-3.5 w-3.5" />
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-100 pb-3 last:border-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink-900">{title}</div>
        <div className="text-[11.5px] text-ink-500">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Équipe : liste + invite + delete
// ──────────────────────────────────────────────────────────────────────

function TeamPanel({
  currentRole,
  currentUserId,
  clientId,
}: {
  currentRole: Role;
  currentUserId: string;
  clientId: string | null;
}) {
  const queryClient = useQueryClient();
  const [filterClientId, setFilterClientId] = React.useState<string | null>(
    currentRole === "ADMIN" ? null : clientId,
  );
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [tempPasswordView, setTempPasswordView] = React.useState<{
    email: string;
    password: string;
  } | null>(null);

  const { data: users = [], isLoading } = useQuery<TeamUser[]>({
    queryKey: ["team-users", filterClientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterClientId) params.set("clientId", filterClientId);
      const res = await fetch(`/api/users?${params.toString()}`);
      if (!res.ok) throw new Error("Erreur chargement équipe");
      return res.json();
    },
  });

  const { data: clients = [] } = useQuery<Array<{ id: string; name: string; slug: string }>>({
    queryKey: ["clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients");
      if (!res.ok) return [];
      return res.json();
    },
    enabled: currentRole === "ADMIN" || currentRole === "COMMERCIAL",
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Erreur suppression");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Utilisateur retiré");
      queryClient.invalidateQueries({ queryKey: ["team-users"] });
    },
    onError: (err: Error) => toast.error("Suppression impossible", { description: err.message }),
  });

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
              Équipe
            </h3>
            <p className="mt-0.5 text-[12px] text-ink-500">
              {currentRole === "ADMIN"
                ? "Tous les utilisateurs de la plateforme."
                : "Membres rattachés à votre compte client."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(currentRole === "ADMIN" || currentRole === "COMMERCIAL") &&
              clients.length > 0 && (
                <select
                  value={filterClientId ?? ""}
                  onChange={(e) => setFilterClientId(e.target.value || null)}
                  className="h-9 rounded-md border border-ink-200 bg-white px-3 text-[12.5px] text-ink-800 shadow-xs"
                >
                  <option value="">{currentRole === "ADMIN" ? "Tous les clients" : "Mon scope"}</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            <Button
              variant="primary"
              size="md"
              onClick={() => setInviteOpen(true)}
              className="gap-1.5"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Inviter
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-[200px] w-full rounded-md" />
        ) : users.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 bg-ink-50/40 p-8 text-center text-[12.5px] text-ink-500">
            Aucun utilisateur dans ce périmètre.
          </div>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-md border border-ink-200 bg-white">
            {users.map((u) => {
              const meta = ROLE_META[u.role];
              const isSelf = u.id === currentUserId;
              return (
                <li key={u.id} className="flex items-center gap-3 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold uppercase text-brand-700">
                    {(u.name ?? u.email).slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-ink-900">
                        {u.name ?? u.email}
                      </span>
                      {isSelf && (
                        <Badge variant="outline" size="sm">
                          Moi
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11.5px] text-ink-500">
                      <span className="font-mono">{u.email}</span>
                      <span className="text-ink-300">·</span>
                      <span>
                        {u.lastLoginAt
                          ? `Vu ${formatRelativeFr(u.lastLoginAt)}`
                          : "Jamais connecté"}
                      </span>
                    </div>
                  </div>
                  <Badge variant={meta.variant} size="sm" className="shrink-0">
                    {meta.label}
                  </Badge>
                  {!isSelf && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        if (confirm(`Retirer ${u.email} de l'équipe ?`)) remove.mutate(u.id);
                      }}
                      aria-label="Retirer"
                      className="text-ink-400 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <InviteDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          currentRole={currentRole}
          defaultClientId={filterClientId ?? clientId ?? null}
          clients={clients}
          onSuccess={(res) => {
            setInviteOpen(false);
            setTempPasswordView({ email: res.email, password: res.tempPassword });
            queryClient.invalidateQueries({ queryKey: ["team-users"] });
          }}
        />

        <TempPasswordDialog
          info={tempPasswordView}
          onClose={() => setTempPasswordView(null)}
        />
      </CardContent>
    </Card>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  currentRole,
  defaultClientId,
  clients,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentRole: Role;
  defaultClientId: string | null;
  clients: Array<{ id: string; name: string; slug: string }>;
  onSuccess: (res: { id: string; email: string; tempPassword: string }) => void;
}) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<Role>("EDITOR");
  const [clientId, setClientId] = React.useState<string | null>(defaultClientId);

  React.useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setRole("EDITOR");
      setClientId(defaultClientId);
    }
  }, [open, defaultClientId]);

  const adminRoles: Role[] = ["ADMIN", "COMMERCIAL", "CLIENT", "EDITOR", "VIEWER"];
  const tenantRoles: Role[] = ["EDITOR", "VIEWER"];
  const availableRoles = currentRole === "ADMIN" ? adminRoles : tenantRoles;

  const needsClient = role === "CLIENT" || role === "EDITOR" || role === "VIEWER";

  const submit = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name,
          role,
          clientId: needsClient ? clientId : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erreur invitation");
      return body;
    },
    onSuccess,
    onError: (err: Error) => toast.error("Invitation impossible", { description: err.message }),
  });

  const canSubmit = email.trim() && name.trim() && (!needsClient || clientId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inviter un utilisateur</DialogTitle>
          <DialogDescription>
            Un mot de passe temporaire sera généré et affiché une seule fois.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@entreprise.fr"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="invite-name">Nom</Label>
            <Input
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Prénom Nom"
              className="mt-1.5"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="invite-role">Rôle</Label>
              <select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="mt-1.5 h-9 w-full rounded-md border border-ink-200 bg-white px-3 text-[13px] text-ink-800 shadow-xs"
              >
                {availableRoles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_META[r].label}
                  </option>
                ))}
              </select>
            </div>
            {needsClient && currentRole === "ADMIN" && (
              <div>
                <Label htmlFor="invite-client">Client</Label>
                <select
                  id="invite-client"
                  value={clientId ?? ""}
                  onChange={(e) => setClientId(e.target.value || null)}
                  className="mt-1.5 h-9 w-full rounded-md border border-ink-200 bg-white px-3 text-[13px] text-ink-800 shadow-xs"
                >
                  <option value="">— Choisir —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!canSubmit || submit.isPending}
            onClick={() => submit.mutate()}
            className="gap-1.5"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {submit.isPending ? "Envoi…" : "Inviter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TempPasswordDialog({
  info,
  onClose,
}: {
  info: { email: string; password: string } | null;
  onClose: () => void;
}) {
  if (!info) return null;
  return (
    <Dialog open={!!info} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Utilisateur créé</DialogTitle>
          <DialogDescription>
            Communiquez ces identifiants à <span className="font-mono">{info.email}</span>.
            Ce mot de passe ne sera affiché qu'une seule fois.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-amber-800">
              Email
            </div>
            <div className="font-mono text-[13px] text-ink-800">{info.email}</div>
          </div>
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-amber-800">
              Mot de passe temporaire
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all rounded bg-white px-2 py-1 font-mono text-[13px] text-ink-900 shadow-xs">
                {info.password}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(info.password);
                  toast.success("Mot de passe copié");
                }}
                className="gap-1"
              >
                <Copy className="h-3 w-3" />
                Copier
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="primary" size="md" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Intégrations (placeholders)
// ──────────────────────────────────────────────────────────────────────

const INTEGRATIONS: Array<{
  id: string;
  name: string;
  category: string;
  description: string;
  status: "soon" | "planned";
}> = [
  {
    id: "folk",
    name: "Folk CRM",
    category: "CRM",
    description: "Synchroniser leads et opportunités vers Folk pour le suivi commercial multi-tenant.",
    status: "planned",
  },
  {
    id: "smartlead",
    name: "Smartlead",
    category: "Cold email",
    description: "Brancher vos campagnes Full Service. Replies remontent dans Unibox.",
    status: "planned",
  },
  {
    id: "resend",
    name: "Resend",
    category: "Transactionnel",
    description: "Envoi des digests hebdo et alertes pépites depuis votre domaine vérifié.",
    status: "soon",
  },
  {
    id: "aircall",
    name: "Aircall",
    category: "Téléphonie",
    description: "Click-to-call directement depuis les fiches lead.",
    status: "planned",
  },
  {
    id: "calcom",
    name: "Cal.com",
    category: "Booking",
    description: "Page de prise de RDV personnalisée pour vos prospects.",
    status: "planned",
  },
];

function IntegrationsPanel() {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
            Intégrations
          </h3>
          <p className="mt-0.5 text-[12px] text-ink-500">
            Connectez vos outils existants au Trigger Engine.
          </p>
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {INTEGRATIONS.map((it) => (
            <li
              key={it.id}
              className={cn(
                "flex flex-col gap-2 rounded-md border border-ink-200 bg-white p-4 shadow-xs",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-display text-[14px] font-semibold tracking-tight text-ink-900">
                    {it.name}
                  </div>
                  <div className="text-[10.5px] uppercase tracking-wider text-ink-400">
                    {it.category}
                  </div>
                </div>
                <Badge
                  variant={it.status === "soon" ? "warning" : "default"}
                  size="sm"
                >
                  {it.status === "soon" ? "Bientôt" : "Roadmap"}
                </Badge>
              </div>
              <p className="text-[12px] leading-relaxed text-ink-600">{it.description}</p>
              <Button variant="secondary" size="sm" disabled className="gap-1.5">
                <Plug className="h-3 w-3" />
                Connecter
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex items-start gap-2 rounded-md border border-ink-200 bg-ink-50/40 p-3 text-[11.5px] text-ink-600">
          <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
          <span>
            Besoin d'une intégration personnalisée ? Écrivez à{" "}
            <a
              className="font-medium text-brand-700 underline-offset-2 hover:underline"
              href="mailto:contact@ifind.fr"
            >
              contact@ifind.fr
            </a>{" "}
            — on peut brancher la plupart des outils via webhook.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────────────────────────────

function SettingsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64 rounded-md" />
      <Skeleton className="h-[500px] w-full rounded-xl" />
    </div>
  );
}
