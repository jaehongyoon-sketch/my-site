import { env } from "cloudflare:workers";
import { z } from "zod";
import { getOwnEvent } from "@/lib/events/service";
import { readMarket } from "@/lib/practice/market";
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
    if (!env.DB) throw Error();
    const event = await getOwnEvent(env.DB, id);
    if (!event)
      return Response.json(
        { error: "Event not found." },
        { status: 404, headers },
      );
    return Response.json(await readMarket(env.DB, event), { headers });
  } catch {
    return Response.json(
      { error: "Market unavailable. Please retry." },
      { status: 503, headers },
    );
  }
}
