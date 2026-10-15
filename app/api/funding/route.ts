import { boundedBody } from "@/lib/security/request-body";
import { limitMutation } from "@/lib/security/rate-limit";
import { env } from "cloudflare:workers";
import { getGoogleUser } from "@/lib/auth/google";
import { AccountError, checkMutationOrigin } from "@/lib/accounts/service";
import { AccessError } from "@/lib/accounts/access";
import { fundingStatus, requestFunding } from "@/lib/funding/service";
import { FundingUnavailable } from "@/lib/funding/model";
async function handle(request: Request, mutation: boolean) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const identity = await getGoogleUser();
    if (!identity)
      return Response.json(
        { error: "Sign in and create an active Event profile first." },
        { status: 401, headers },
      );
    if (!env.DB) throw Error("Storage unavailable");
    if (!mutation)
      return Response.json(await fundingStatus(env.DB, identity), { headers });
    checkMutationOrigin(request);
    await limitMutation(env.DB, identity.userId, new URL(request.url).pathname);
    const body = await boundedBody(request);
    if (body.length > 2048) throw new AccessError(413, "Request is too large.");
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      throw new AccessError(400, "Invalid JSON.");
    }
    return Response.json(await requestFunding(env.DB, identity, input), {
      headers,
    });
  } catch (e) {
    if (e instanceof AccountError && e.status === 429)
      Object.assign(headers, { "Retry-After": "60" });
    if (
      e instanceof AccessError ||
      e instanceof AccountError ||
      e instanceof FundingUnavailable
    )
      return Response.json(
        {
          error: e.message,
          ...(e instanceof FundingUnavailable ? { code: e.code } : {}),
        },
        { status: e.status, headers },
      );
    return Response.json(
      { error: "Funding status is unavailable. No transfer can be submitted." },
      { status: 503, headers },
    );
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
