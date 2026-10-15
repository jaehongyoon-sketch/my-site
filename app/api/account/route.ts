import { boundedBody } from "@/lib/security/request-body";
import { limitMutation } from "@/lib/security/rate-limit";
import { isAdministrator } from "@/lib/accounts/access";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { getGoogleUser } from "@/lib/auth/google";
import {
  AccountError,
  checkMutationOrigin,
  createAccount,
  deactivateAccount,
  readAccount,
  reactivateAccount,
  updateAccount,
} from "@/lib/accounts/service";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
async function handle(request: Request) {
  try {
    const identity = await getGoogleUser();
    if (!identity)
      return Response.json(
        { error: "Sign in with Google to continue." },
        { status: 401, headers },
      );
    if (request.method !== "GET") checkMutationOrigin(request);
    if (!env.DB) throw new Error("DB unavailable");
    const adminId = (env as unknown as Record<string, string | undefined>)
      .ADMIN_ACCOUNT_ID;
    let account;
    if (request.method === "GET") account = await readAccount(env.DB, identity);
    else {
      await limitMutation(
        env.DB,
        identity.userId,
        new URL(request.url).pathname,
      );
      const raw = await boundedBody(request);
      if (raw.length > 4096)
        throw new AccountError(413, "Request is too large.");
      let input: unknown;
      try {
        input = JSON.parse(raw);
      } catch {
        throw new AccountError(400, "Invalid request.");
      }
      if (request.method === "POST")
        account = await createAccount(env.DB, identity, input);
      else if (request.method === "PATCH") {
        const value = z
          .object({
            action: z.enum(["update", "reactivate"]),
            displayName: z.string(),
          })
          .strict()
          .parse(input);
        account =
          value.action === "reactivate"
            ? await reactivateAccount(
                env.DB,
                identity,
                {
                  displayName: value.displayName,
                },
                adminId,
              )
            : await updateAccount(
                env.DB,
                identity,
                {
                  displayName: value.displayName,
                },
                adminId,
              );
      } else {
        z.object({ confirmation: z.literal("DEACTIVATE") })
          .strict()
          .parse(input);
        account = await deactivateAccount(env.DB, identity);
      }
    }
    return Response.json(
      {
        account,
        isAdmin: isAdministrator(
          account,
          (env as unknown as Record<string, string | undefined>)
            .ADMIN_ACCOUNT_ID,
        ),
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof AccountError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error:
            "Enter a display name of 1–60 characters and check your request.",
        },
        { status: 400, headers },
      );
    console.error("Account storage operation failed");
    return Response.json(
      {
        error:
          "Account services are temporarily unavailable. Your changes have not been confirmed. Please retry.",
      },
      { status: 503, headers },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
