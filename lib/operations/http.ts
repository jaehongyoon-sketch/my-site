import { boundedBody } from "@/lib/security/request-body";
import { limitMutation } from "@/lib/security/rate-limit";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { getGoogleUser } from "../auth/google";
import { checkMutationOrigin, AccountError } from "../accounts/service";
import { EventError } from "../events/service";
import { operationStatus, operationAudit, changeOperations } from "./service";
export async function operationsRequest(request: Request, publicOnly = false) {
  const headers = { "Cache-Control": "no-store", Vary: "Cookie" };
  try {
    if (!env.DB) throw Error();
    if (publicOnly) {
      const s = await operationStatus(env.DB);
      return Response.json({ paused: s.paused }, { headers });
    }
    const user = await getGoogleUser();
    if (!user)
      return Response.json(
        { error: "Sign in required." },
        { status: 401, headers },
      );
    const admin = (env as unknown as Record<string, string | undefined>)
      .ADMIN_ACCOUNT_ID;
    if (request.method === "GET") {
      const p = new URL(request.url).searchParams;
      return Response.json(
        await operationAudit(env.DB, user, admin, {
          page: Number(p.get("page") ?? 0),
          action: p.get("action") ?? "",
          entityId: p.get("entityId") ?? "",
        }),
        { headers },
      );
    }
    checkMutationOrigin(request);
    await limitMutation(env.DB, user.userId, new URL(request.url).pathname);
    const raw = await boundedBody(request);
    if (raw.length > 5000) throw new EventError(413, "Request too large.");
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new EventError(400, "Invalid request.");
    }
    return Response.json(await changeOperations(env.DB, user, admin, input), {
      headers,
    });
  } catch (e) {
    if (e instanceof AccountError && e.status === 429)
      Object.assign(headers, { "Retry-After": "60" });
    const known = e instanceof EventError || e instanceof AccountError;
    return Response.json(
      {
        error: known
          ? e.message
          : e instanceof z.ZodError
            ? "Check the reason and request fields."
            : "Operations unavailable. Refresh or retry the same request.",
      },
      {
        status: known ? e.status : e instanceof z.ZodError ? 400 : 503,
        headers,
      },
    );
  }
}
