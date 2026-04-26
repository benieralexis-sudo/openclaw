import { NextResponse, type NextRequest } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { requireApiSession } from "@/server/session";
import { requireAdmin } from "@/server/admin";

const execAsync = promisify(exec);

// Containers attendus dans la stack
const EXPECTED_CONTAINERS = [
  { name: "ifind-postgres", role: "Postgres dashboard v2", critical: true },
  { name: "moltbot-mission-control-1", role: "Ancien dashboard (rollback)", critical: false },
  { name: "moltbot-landing-page-1", role: "Landing v1 (legacy)", critical: false },
  { name: "moltbot-telegram-router-1", role: "Bot Telegram (Trigger Engine)", critical: true },
];

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const adm = requireAdmin(s.user);
  if (!adm.ok) return adm.response;

  // Lecture docker ps - safe (read-only)
  let dockerLines: string[] = [];
  try {
    const { stdout } = await execAsync(
      `docker ps -a --format '{{.Names}}|{{.Status}}|{{.Image}}'`,
      { timeout: 3000 },
    );
    dockerLines = stdout.split("\n").filter(Boolean);
  } catch {
    // Docker indisponible ou hors VPS — retourne un état dégradé
    return NextResponse.json({
      dockerAvailable: false,
      containers: EXPECTED_CONTAINERS.map((c) => ({
        ...c,
        running: false,
        status: "Docker indisponible",
      })),
      nextServer: { running: true, pid: process.pid, uptime: process.uptime() },
    });
  }

  const containers = EXPECTED_CONTAINERS.map((expected) => {
    const found = dockerLines.find((l) => l.startsWith(expected.name + "|"));
    if (!found) {
      return { ...expected, running: false, status: "Non trouvé" };
    }
    const [, status, image] = found.split("|");
    return {
      ...expected,
      running: status?.toLowerCase().startsWith("up") ?? false,
      status: status ?? "?",
      image: image ?? null,
    };
  });

  return NextResponse.json({
    dockerAvailable: true,
    containers,
    nextServer: {
      running: true,
      pid: process.pid,
      uptime: process.uptime(),
      nodeVersion: process.version,
    },
  });
}
