import { ClientProfile } from "@/components/clients/client-profile";

export const metadata = {
  title: "Fiche client — iFIND",
};

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClientProfile clientId={id} />;
}
