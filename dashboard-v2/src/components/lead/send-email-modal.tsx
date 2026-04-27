"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, RefreshCw, Save, Send, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

interface MailboxPublic {
  id: string;
  user: string;
  label: string;
}

interface PitchPayload {
  subject: string;
  body: string;
  followup?: string;
  variants?: { subject: string; openLine: string }[];
}

interface LinkedinDmPayload {
  inmail?: string;
  connection?: string;
}

interface CallBriefPayload {
  intro?: string;
  hook?: string;
  questions?: string[];
}

type Template = "pitch" | "linkedin-dm" | "call-brief";

interface LeadInfo {
  id: string;
  fullName: string | null;
  email: string | null;
  companyName: string;
  jobTitle?: string | null;
}

interface SendEmailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadInfo;
}

// ──────────────────────────────────────────────────────────────────────
// localStorage drafts
// ──────────────────────────────────────────────────────────────────────

const draftKey = (leadId: string) => `ifind:send-email-draft:${leadId}`;

function loadDraft(leadId: string): {
  subject: string;
  body: string;
  fromMailboxId: string;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(leadId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveDraft(
  leadId: string,
  data: { subject: string; body: string; fromMailboxId: string },
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(draftKey(leadId), JSON.stringify(data));
  } catch {
    /* ignore quota errors */
  }
}

function clearDraft(leadId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(leadId));
  } catch {
    /* ignore */
  }
}

// ──────────────────────────────────────────────────────────────────────
// Composant principal
// ──────────────────────────────────────────────────────────────────────

export function SendEmailModal({ open, onOpenChange, lead }: SendEmailModalProps) {
  const queryClient = useQueryClient();
  const [fromMailboxId, setFromMailboxId] = React.useState<string>("");
  const [subject, setSubject] = React.useState<string>("");
  const [body, setBody] = React.useState<string>("");
  const [toEmail, setToEmail] = React.useState<string>(lead.email ?? "");
  const [usedTemplate, setUsedTemplate] = React.useState<Template | "manual">("manual");

  // Charger les mailboxes
  const { data: mailboxData } = useQuery<{ mailboxes: MailboxPublic[] }>({
    queryKey: ["mailboxes"],
    queryFn: async () => {
      const r = await fetch("/api/mailboxes");
      if (!r.ok) throw new Error("Impossible de charger les mailboxes");
      return r.json();
    },
    enabled: open,
  });

  const mailboxes = mailboxData?.mailboxes ?? [];

  // Hydrater depuis draft localStorage
  React.useEffect(() => {
    if (!open) return;
    const draft = loadDraft(lead.id);
    if (draft) {
      setSubject(draft.subject || "");
      setBody(draft.body || "");
      setFromMailboxId(draft.fromMailboxId || "");
    }
    setToEmail(lead.email ?? "");
  }, [open, lead.id, lead.email]);

  // Auto-select 1ère mailbox
  React.useEffect(() => {
    if (!fromMailboxId && mailboxes.length > 0 && mailboxes[0]) {
      setFromMailboxId(mailboxes[0].id);
    }
  }, [mailboxes, fromMailboxId]);

  // Génération template
  const genTemplate = useMutation({
    mutationFn: async ({
      template,
      force,
    }: {
      template: Template;
      force?: boolean;
    }) => {
      const url = `/api/leads/${lead.id}/${template}${force ? "?force=true" : ""}`;
      const r = await fetch(url, { method: "POST" });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? `Génération ${template} échouée`);
      return { template, force, json };
    },
    onSuccess: ({ template, force, json }) => {
      let newSubject = "";
      let newBody = "";

      if (template === "pitch") {
        const p = json.pitch as PitchPayload | null;
        if (p) {
          newSubject = p.subject || "";
          newBody = p.body || "";
        }
      } else if (template === "linkedin-dm") {
        const d = json.linkedinDm as LinkedinDmPayload | null;
        if (d) {
          // Inmail au format Sujet:\n\nCorps
          const inmail = d.inmail ?? "";
          const splitIdx = inmail.indexOf("\n\n");
          if (splitIdx > 0) {
            newSubject = inmail.slice(0, splitIdx).replace(/^Sujet\s*:\s*/i, "").trim();
            newBody = inmail.slice(splitIdx + 2).trim();
          } else {
            newSubject = `Échange rapide — ${lead.companyName}`;
            newBody = inmail;
          }
        }
      } else if (template === "call-brief") {
        const cb = json.callBrief as CallBriefPayload | null;
        if (cb) {
          newSubject = `Suivi appel — ${lead.companyName}`;
          newBody = [
            cb.intro,
            "",
            cb.hook,
            "",
            cb.questions && cb.questions.length > 0
              ? "Quelques questions :\n" + cb.questions.map((q) => `- ${q}`).join("\n")
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        }
      }

      if (newSubject) setSubject(newSubject);
      if (newBody) setBody(newBody);
      setUsedTemplate(template);

      if (json.cached && !force) {
        toast.info("Template depuis le cache", {
          description: "Cliquez à nouveau pour régénérer (consomme des tokens Opus).",
        });
      } else {
        toast.success(`Template ${template} prêt`, {
          description: "Vérifiez le contenu avant envoi.",
        });
      }
    },
    onError: (err: Error) => {
      toast.error("Génération impossible", { description: err.message });
    },
  });

  // Cache locale 'a déjà été cliqué' pour basculer en force=true au 2e clic
  const [generatedOnce, setGeneratedOnce] = React.useState<Set<Template>>(new Set());
  const handleGenTemplate = (template: Template) => {
    const force = generatedOnce.has(template);
    genTemplate.mutate({ template, force });
    if (!force) {
      setGeneratedOnce((prev) => new Set(prev).add(template));
    }
  };

  // Envoi
  const sendMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/leads/${lead.id}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromMailboxId,
          toEmail: toEmail || undefined,
          subject,
          body,
          template: usedTemplate,
        }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Envoi échoué");
      return json;
    },
    onSuccess: (json) => {
      toast.success("Email envoyé", {
        description: `${json.dailyCount}/${json.dailyCap} envoyés aujourd'hui`,
      });
      clearDraft(lead.id);
      queryClient.invalidateQueries({ queryKey: ["lead", lead.id, "email-activity"] });
      queryClient.invalidateQueries({ queryKey: ["trigger-detail"] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error("Envoi impossible", { description: err.message });
    },
  });

  const canSend =
    !!fromMailboxId && !!subject.trim() && !!body.trim() && !!toEmail.trim();

  const handleSaveDraft = () => {
    saveDraft(lead.id, { subject, body, fromMailboxId });
    toast.success("Brouillon sauvegardé localement");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-brand-600" />
            Envoyer un email
          </DialogTitle>
          <DialogDescription>
            À {lead.fullName ?? "—"} ({lead.email ?? "pas d'email"}) — {lead.companyName}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Mailbox */}
          <div className="grid gap-1.5">
            <Label>Mailbox d'envoi</Label>
            <select
              value={fromMailboxId}
              onChange={(e) => setFromMailboxId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 hover:border-ink-300 focus-visible:outline-none focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-500/10"
            >
              {mailboxes.length === 0 && <option value="">Aucune mailbox configurée</option>}
              {mailboxes.map((mb) => (
                <option key={mb.id} value={mb.id}>
                  {mb.label} — {mb.user}
                </option>
              ))}
            </select>
          </div>

          {/* Destinataire override */}
          <div className="grid gap-1.5">
            <Label>Destinataire</Label>
            <Input
              type="email"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder={lead.email ?? "destinataire@example.com"}
            />
          </div>

          {/* Templates Opus */}
          <div className="grid gap-1.5">
            <Label>Pré-remplir depuis un template Opus</Label>
            <div className="flex flex-wrap gap-2">
              <TemplateButton
                label="Pitch"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                pending={genTemplate.isPending && genTemplate.variables?.template === "pitch"}
                used={generatedOnce.has("pitch")}
                onClick={() => handleGenTemplate("pitch")}
              />
              <TemplateButton
                label="LinkedIn DM"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                pending={
                  genTemplate.isPending && genTemplate.variables?.template === "linkedin-dm"
                }
                used={generatedOnce.has("linkedin-dm")}
                onClick={() => handleGenTemplate("linkedin-dm")}
              />
              <TemplateButton
                label="Call brief"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                pending={
                  genTemplate.isPending && genTemplate.variables?.template === "call-brief"
                }
                used={generatedOnce.has("call-brief")}
                onClick={() => handleGenTemplate("call-brief")}
              />
            </div>
            <p className="text-[11px] text-ink-500">
              Le 2ᵉ clic sur un template force la régénération (consomme des tokens Opus).
            </p>
          </div>

          {/* Sujet */}
          <div className="grid gap-1.5">
            <Label>Sujet</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ex. Levée Série A — coup de main sur l'embauche QA ?"
            />
            <div className={cn(
              "text-[11px]",
              subject.length > 60 ? "text-amber-600" : "text-ink-400"
            )}>
              {subject.length} caractères {subject.length > 60 ? "(trop long, viser ≤ 60)" : ""}
            </div>
          </div>

          {/* Body */}
          <div className="grid gap-1.5">
            <Label>Corps de l'email</Label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 font-mono text-[12.5px] text-ink-900 hover:border-ink-300 focus-visible:outline-none focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-500/10"
              placeholder="Bonjour Frédéric,..."
            />
            <div className="text-[11px] text-ink-400">{body.length} caractères</div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button variant="secondary" size="md" onClick={handleSaveDraft} className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            Brouillon
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => sendMutation.mutate()}
            disabled={!canSend || sendMutation.isPending}
            className="gap-1.5"
          >
            {sendMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Envoi…
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                Envoyer
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateButton({
  label,
  icon,
  pending,
  used,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  pending: boolean;
  used: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={onClick}
      className="gap-1.5"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : used ? (
        <RefreshCw className="h-3.5 w-3.5" />
      ) : (
        icon
      )}
      {label}
    </Button>
  );
}
