import { env } from "cloudflare:workers";
import { z } from "zod";
import { getOwnEvent } from "@/lib/events/service";
import { deriveMarketState } from "@/lib/events/market-state";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success)
      return Response.json(
        { error: "Event not found." },
        { status: 404, headers },
      );
    if (!env.DB) throw new Error("DB unavailable");
    const event = await getOwnEvent(env.DB, id);
    if (!event)
      return Response.json(
        { error: "Event not found." },
        { status: 404, headers },
      );
    // No price adapter is registered. Never infer 50/50 or prices from an administrator's text.
    return Response.json(deriveMarketState(event), { headers });
  } catch {
    console.error("Event market state unavailable");
    return Response.json(
      { error: "Unable to check event status. Retry shortly." },
      { status: 503, headers },
    );
  }
}
