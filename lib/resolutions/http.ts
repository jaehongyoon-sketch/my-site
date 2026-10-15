import { boundedBody } from "@/lib/security/request-body";
import { limitMutation } from "@/lib/security/rate-limit";
import { env } from "cloudflare:workers";
import { getGoogleUser } from "../auth/google";
import { AccountError, checkMutationOrigin } from "../accounts/service";
import { AccessError } from "../accounts/access";
import { EventError } from "../events/service";
import {
  listResolutions,
  saveResolution,
  publicResolution,
  settlementPreview,
} from "./service";
export async function resolutionRequest(
  request: Request,
  action: "list" | "save" | "public" | "preview",
  eventId?: string,
) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    if (!env.DB) throw Error("Storage unavailable");
    if (action === "public")
      return Response.json(await publicResolution(env.DB, eventId ?? ""), {
        headers,
      });
    const identity = await getGoogleUser();
    if (!identity)
      return Response.json(
        { error: "Sign in required." },
        { status: 401, headers },
      );
    const admin = (env as unknown as Record<string, string | undefined>)
      .ADMIN_ACCOUNT_ID;
    if (action === "list")
      return Response.json(
        await listResolutions(
          env.DB,
          identity,
          admin,
          Number(new URL(request.url).searchParams.get("page") ?? 0),
        ),
        { headers },
      );
    if (action === "preview")
      return Response.json(
        await settlementPreview(
          env.DB,
          identity,
          new URL(request.url).searchParams.get("eventId") ?? "",
        ),
        { headers },
      );
    checkMutationOrigin(request);
    await limitMutation(env.DB, identity.userId, new URL(request.url).pathname);
    const text = await boundedBody(request);
    if (text.length > 12000) throw new EventError(413, "Request too large.");
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new EventError(400, "Invalid JSON.");
    }
    return Response.json(await saveResolution(env.DB, identity, admin, raw), {
      headers,
    });
  } catch (e) {
    if (e instanceof AccountError && e.status === 429)
      Object.assign(headers, { "Retry-After": "60" });
    const known =
      e instanceof AccessError ||
      e instanceof AccountError ||
      e instanceof EventError;
    return Response.json(
      {
        error: known
          ? e.message
          : "Unable to confirm the result. Refresh or retry the same request.",
      },
      { status: known ? e.status : 503, headers },
    );
  }
}
