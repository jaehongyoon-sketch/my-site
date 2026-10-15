import { boundedBody } from "@/lib/security/request-body";
import { limitMutation } from "@/lib/security/rate-limit";
import { env } from "cloudflare:workers";
import { getGoogleUser } from "../auth/google";
import { AccountError, checkMutationOrigin } from "../accounts/service";
import { AccessError } from "../accounts/access";
import { eligibility, adminEligibility, changeRestriction } from "./service";
export async function eligibilityRequest(
  request: Request,
  action: "self" | "list" | "change",
) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const identity = await getGoogleUser();
    if (!identity)
      return Response.json(
        { error: "Sign in required." },
        { status: 401, headers },
      );
    if (!env.DB) throw Error("Storage unavailable");
    const configured = (env as unknown as Record<string, string | undefined>)
      .ADMIN_ACCOUNT_ID;
    if (action === "self")
      return Response.json(await eligibility(env.DB, identity), { headers });
    if (action === "list")
      return Response.json(
        await adminEligibility(
          env.DB,
          identity,
          configured,
          Number(new URL(request.url).searchParams.get("page") ?? 0),
        ),
        { headers },
      );
    checkMutationOrigin(request);
    await limitMutation(env.DB, identity.userId, new URL(request.url).pathname);
    const text = await boundedBody(request);
    if (text.length > 4096) throw new AccessError(413, "Request too large.");
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AccessError(400, "Invalid JSON.");
    }
    return Response.json(
      await changeRestriction(env.DB, identity, configured, raw),
      { headers },
    );
  } catch (e) {
    if (e instanceof AccountError && e.status === 429)
      Object.assign(headers, { "Retry-After": "60" });
    return Response.json(
      {
        error:
          e instanceof AccessError || e instanceof AccountError
            ? e.message
            : "Eligibility is temporarily unavailable. Refresh before retrying.",
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
