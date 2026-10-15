import { env } from "cloudflare:workers";
import { listOwnEvents, EventError } from "@/lib/events/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    if (!env.DB) throw new Error();
    const p = new URL(request.url).searchParams;
    return Response.json(
      {
        source: "event",
        ...(await listOwnEvents(env.DB, {
          q: p.get("q") ?? "",
          page: Number(p.get("page") ?? 0),
          status: p.get("status") ?? "open",
          category: p.get("category") ?? "all",
        })),
      },
      { headers },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof EventError
            ? e.message
            : "Events unavailable. Retry later.",
      },
      { status: e instanceof EventError ? e.status : 503, headers },
    );
  }
}
