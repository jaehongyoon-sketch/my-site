import { boundedBody } from "@/lib/security/request-body";
import { limitMutation } from "@/lib/security/rate-limit";
import { reserveSell, cancelSell, SellError } from "./sells";
import { env } from "cloudflare:workers";
import { getGoogleUser } from "@/lib/auth/google";
import { AccountError, checkMutationOrigin } from "@/lib/accounts/service";
import { AccessError } from "@/lib/accounts/access";
import {
  PracticeError,
  placePractice,
  practiceAccount,
  startPractice,
  continueMatching,
  cancelPractice,
} from "./service";
export async function practiceRequest(
  request: Request,
  action:
    "read" | "start" | "order" | "match" | "cancel" | "sell" | "sell-cancel",
) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const identity = await getGoogleUser();
    if (!identity)
      return Response.json(
        { error: "Sign in and create an active Event profile first." },
        { status: 401, headers },
      );
    if (!env.DB) throw Error("storage");
    let input;
    if (action !== "read") {
      checkMutationOrigin(request);
      await limitMutation(
        env.DB,
        identity.userId,
        new URL(request.url).pathname,
      );
      const body = await boundedBody(request);
      if (body.length > 2048)
        throw new PracticeError(413, "TOO_LARGE", "Request is too large.");
      try {
        input = JSON.parse(body);
      } catch {
        throw new PracticeError(400, "INVALID_JSON", "Invalid request.");
      }
    }
    if (
      action === "start" &&
      JSON.stringify(input) !==
        JSON.stringify({ acknowledgement: "PRACTICE_ONLY" })
    )
      throw new PracticeError(
        400,
        "ACK_REQUIRED",
        "Confirm practice funds have no cash value.",
      );
    const result =
      action === "read"
        ? await practiceAccount(
            env.DB,
            identity,
            Number(new URL(request.url).searchParams.get("page") ?? 0),
            undefined,
            Number(new URL(request.url).searchParams.get("positionPage") ?? 0),
            Number(new URL(request.url).searchParams.get("sellPage") ?? 0),
          )
        : action === "start"
          ? await startPractice(env.DB, identity)
          : action === "match"
            ? await continueMatching(env.DB, identity, input)
            : action === "cancel"
              ? await cancelPractice(env.DB, identity, input)
              : action === "sell"
                ? await reserveSell(env.DB, identity, input)
                : action === "sell-cancel"
                  ? await cancelSell(env.DB, identity, input)
                  : await placePractice(env.DB, identity, input);
    return Response.json(result, { headers });
  } catch (e) {
    if (e instanceof AccountError && e.status === 429)
      Object.assign(headers, { "Retry-After": "60" });
    if (
      e instanceof SellError ||
      e instanceof PracticeError ||
      e instanceof AccountError ||
      e instanceof AccessError
    )
      return Response.json(
        {
          error: e.message,
          ...(e instanceof PracticeError || e instanceof SellError
            ? { code: e.code }
            : {}),
        },
        { status: e.status, headers },
      );
    console.error("Practice request unavailable");
    return Response.json(
      {
        error:
          "Unable to confirm the result. Check practice orders or retry the same request.",
      },
      { status: 503, headers },
    );
  }
}
