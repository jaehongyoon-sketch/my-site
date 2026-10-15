import { boundedBody } from "@/lib/security/request-body";
import { limitMutation } from "@/lib/security/rate-limit";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { getGoogleUser } from "@/lib/auth/google";
import { checkMutationOrigin, AccountError } from "@/lib/accounts/service";
import {
  requireEventAdmin,
  listOwnEvents,
  saveOwnEvent,
  deleteOwnDraft,
  EventError,
} from "@/lib/events/service";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
async function handle(request: Request) {
  try {
    const identity = await getGoogleUser();
    if (!identity)
      return Response.json(
        { error: "Sign in required." },
        { status: 401, headers },
      );
    if (!env.DB) throw new Error("DB unavailable");
    const adminId = (env as unknown as Record<string, string | undefined>)
      .ADMIN_ACCOUNT_ID;
    await requireEventAdmin(env.DB, identity, adminId);
    if (request.method === "GET") {
      const p = new URL(request.url).searchParams;
      return Response.json(
        await listOwnEvents(
          env.DB,
          {
            q: p.get("q") ?? "",
            page: Number(p.get("page") ?? 0),
            status: p.get("status") ?? "all",
          },
          true,
        ),
        { headers },
      );
    }
    checkMutationOrigin(request);
    await limitMutation(env.DB, identity.userId, new URL(request.url).pathname);
    const raw = await boundedBody(request);
    if (raw.length > 16000) throw new EventError(413, "Event is too large.");
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new EventError(400, "Invalid request.");
    }
    return Response.json(
      await (request.method === "DELETE" ? deleteOwnDraft : saveOwnEvent)(
        env.DB,
        identity,
        adminId,
        body,
      ),
      {
        headers,
      },
    );
  } catch (e) {
    if (e instanceof AccountError && e.status === 429)
      Object.assign(headers, { "Retry-After": "60" });
    if (e instanceof EventError || e instanceof AccountError)
      return Response.json({ error: e.message }, { status: e.status, headers });
    if (e instanceof z.ZodError)
      return Response.json(
        {
          error:
            "Check title (8–160 characters), rules (30–5,000 characters), HTTPS source, and closing date.",
        },
        { status: 400, headers },
      );
    console.error("Event operation unavailable");
    return Response.json(
      {
        error:
          "Events unavailable. Reload to check whether your save completed.",
      },
      { status: 503, headers },
    );
  }
}
export const GET = handle;
export const PUT = handle;

export const DELETE = handle;
