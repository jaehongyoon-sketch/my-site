import { boundedBody } from "@/lib/security/request-body";
import { limitMutation } from "@/lib/security/rate-limit";
import { env } from "cloudflare:workers";
import { getGoogleUser } from "@/lib/auth/google";
import { AccessError } from "@/lib/accounts/access";
import { AccountError, checkMutationOrigin } from "@/lib/accounts/service";
import { readTradeEvents, syncTradeEvents } from "@/lib/trade-events/service";
async function handle(request: Request, mutation: boolean) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const identity = await getGoogleUser();
    if (!identity)
      return Response.json(
        { error: "Sign in to view trade activity." },
        { status: 401, headers },
      );
    if (!env.DB) throw Error("Storage unavailable");
    if (!mutation) {
      const params = new URL(request.url).searchParams;
      for (const key of params.keys())
        if (key !== "page") throw new AccessError(400, "Unknown filter.");
      return Response.json(
        await readTradeEvents(
          env.DB,
          identity,
          Number(params.get("page") ?? 0),
        ),
        { headers },
      );
    }
    checkMutationOrigin(request);
    await limitMutation(env.DB, identity.userId, new URL(request.url).pathname);
    const body = await boundedBody(request);
    if (body.length > 1024) throw new AccessError(413, "Request too large.");
    let raw;
    try {
      raw = JSON.parse(body);
    } catch {
      throw new AccessError(400, "Invalid JSON.");
    }
    return Response.json(await syncTradeEvents(env.DB, identity, raw), {
      headers,
    });
  } catch (e) {
    if (e instanceof AccountError && e.status === 429)
      Object.assign(headers, { "Retry-After": "60" });
    return Response.json(
      {
        error:
          e instanceof AccessError || e instanceof AccountError
            ? e.message
            : "Activity processing is temporarily unavailable. Retry safely; balances and fills are unchanged.",
      },
      {
        status:
          e instanceof AccessError || e instanceof AccountError
            ? e.status
            : 503,
        headers,
      },
    );
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
