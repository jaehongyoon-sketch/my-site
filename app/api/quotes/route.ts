import { AccountError } from "@/lib/accounts/service";
import { boundedBody } from "@/lib/security/request-body";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { getOwnEvent } from "@/lib/events/service";
import { deriveMarketState } from "@/lib/events/market-state";
const inputSchema = z
  .object({
    marketId: z.string().uuid(),
    outcome: z.enum(["yes", "no"]),
    quantity: z.number().int().min(1).max(10000),
  })
  .strict();
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const raw = await boundedBody(request);
    if (raw.length > 2048)
      return Response.json(
        { error: "Request too large." },
        { status: 413, headers },
      );
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      return Response.json(
        { error: "Invalid request." },
        { status: 400, headers },
      );
    }
    const parsed = inputSchema.safeParse(json);
    if (!parsed.success)
      return Response.json(
        { error: "Invalid event, outcome or quantity." },
        { status: 400, headers },
      );
    if (!env.DB) throw new Error();
    const event = await getOwnEvent(env.DB, parsed.data.marketId);
    if (!event)
      return Response.json(
        { error: "Event not found." },
        { status: 404, headers },
      );
    const state = deriveMarketState(event);
    return Response.json(
      {
        code: state.blockCode,
        error:
          state.phase === "closed"
            ? "This event has closed."
            : "No verified price is available. No quote or order was created.",
        executable: false,
      },
      { status: state.phase === "closed" ? 409 : 503, headers },
    );
  } catch (e) {
    if (e instanceof AccountError)
      return Response.json({ error: e.message }, { status: e.status, headers });
    console.error("Event quote unavailable");
    return Response.json(
      { error: "Pricing is unavailable. No order was created." },
      { status: 503, headers },
    );
  }
}
