import { TriggerBriefBoard } from "@/components/brief/trigger-brief-board";

export const metadata = {
  title: "Brief commercial — iFIND",
};

export default async function TriggerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TriggerBriefBoard triggerId={id} />;
}
