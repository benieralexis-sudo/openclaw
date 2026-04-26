import { redirect } from "next/navigation";
import { requireSession } from "@/server/session";
import { SystemBoard } from "@/components/system/system-board";

export const metadata = {
  title: "Système — iFIND",
};

export default async function SystemPage() {
  const session = await requireSession();
  // requireSession redirige déjà vers /login si pas de session.
  // On vérifie en plus que le rôle est ADMIN.
  const role = (session.user as unknown as { role: string }).role;
  if (role !== "ADMIN") {
    redirect("/dashboard");
  }
  return <SystemBoard />;
}
