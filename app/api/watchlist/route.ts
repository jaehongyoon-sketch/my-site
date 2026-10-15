import { boundedBody } from "@/lib/security/request-body";
import { limitMutation } from "@/lib/security/rate-limit";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { getGoogleUser } from "@/lib/auth/google";
import { AccountError, checkMutationOrigin } from "@/lib/accounts/service";
import {
  AccessError,
  listWatchlist,
  setWatchlist,
} from "@/lib/accounts/access";
import { getOwnEvent } from "@/lib/events/service";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const schema = z
  .object({ marketId: z.string().min(1).max(120), saved: z.boolean() })
  .strict();
async function handle(request: Request) {
  try {
    const identity = await getGoogleUser();
    if (!identity)
      return Response.json(
        { error: "Sign in to save markets." },
        { status: 401, headers },
      );
    if (!env.DB) throw new Error("DB unavailable");
    if (request.method === "GET")
      return Response.json(
        { marketIds: await listWatchlist(env.DB, identity) },
        { headers },
      );
    checkMutationOrigin(request);
    await limitMutation(env.DB, identity.userId, new URL(request.url).pathname);
    const raw = await boundedBody(request);
    if (raw.length > 1024) throw new AccessError(413, "Request is too large.");
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new AccessError(400, "Invalid request.");
    }
    const input = schema.parse(body);
    if (input.saved && !(await getOwnEvent(env.DB, input.marketId)))
      throw new AccessError(404, "Market not found.");
    return Response.json(
      {
        marketIds: await setWatchlist(
          env.DB,
          identity,
          input.marketId,
          input.saved,
        ),
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof AccessError || error instanceof AccountError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    if (error instanceof z.ZodError)
      return Response.json(
        { error: "Invalid watchlist request." },
        { status: 400, headers },
      );
    console.error("Watchlist operation failed");
    return Response.json(
      { error: "Your watchlist is unavailable. Please retry." },
      { status: 503, headers },
    );
  }
}
export const GET = handle;
export const PUT = handle;
