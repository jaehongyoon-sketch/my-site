import { boundedBody } from "@/lib/security/request-body";
import { limitMutation } from "@/lib/security/rate-limit";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { getGoogleUser } from "@/lib/auth/google";
import { AccountError, checkMutationOrigin } from "@/lib/accounts/service";
import {
  approvals,
  getProviderControls,
  reviewProvider,
  ProviderControlError,
} from "@/lib/providers/control";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const schema = z
  .object({
    connectionId: z.string().max(60),
    approval: z.enum(approvals),
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    note: z.string().min(5).max(500),
    evidence: z.string().max(500),
  })
  .strict();
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
    if (request.method === "GET")
      return Response.json(
        await getProviderControls(env.DB, identity, adminId),
        { headers },
      );
    checkMutationOrigin(request);
    await limitMutation(env.DB, identity.userId, new URL(request.url).pathname);
    const raw = await boundedBody(request);
    if (raw.length > 4096)
      throw new ProviderControlError(413, "Request is too large.");
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ProviderControlError(400, "Invalid request.");
    }
    return Response.json(
      await reviewProvider(env.DB, identity, adminId, schema.parse(body)),
      { headers },
    );
  } catch (error) {
    if (error instanceof ProviderControlError || error instanceof AccountError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    if (error instanceof z.ZodError)
      return Response.json(
        { error: "Invalid connection update." },
        { status: 400, headers },
      );
    console.error("Provider administration unavailable");
    return Response.json(
      { error: "Connections unavailable. Please retry." },
      { status: 503, headers },
    );
  }
}
export const GET = handle;
export const PUT = handle;
