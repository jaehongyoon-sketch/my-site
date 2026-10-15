import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import {
  verifyGoogleIdentity,
  randomToken,
  hashToken,
  consumeFlow,
  readSession,
  cookieValue,
  cookieNames,
  authCookie,
} from "../lib/auth/google-core.ts";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const keys = createLocalJWKSet({
  keys: [{ ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" }],
});
async function token(patch = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: "https://accounts.google.com",
    aud: "client",
    sub: "google-user",
    nonce: "nonce",
    email: "test@example.test",
    email_verified: true,
    name: "Example",
    iat: now,
    exp: now + 3600,
    ...patch,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(privateKey);
}
test("signed Google claims map to a stable subject identity", async () => {
  assert.deepEqual(
    await verifyGoogleIdentity(await token(), "client", "nonce", keys),
    {
      userId: "google-user",
      email: "test@example.test",
      displayName: "Example",
    },
  );
});
test("wrong issuer, audience, nonce, expiry or unverified email cannot sign in", async () => {
  for (const patch of [
    { iss: "https://evil.example" },
    { aud: "other" },
    { nonce: "wrong" },
    { exp: 1 },
    { email_verified: false },
    { azp: "other" },
    { sub: "" },
    { iat: Math.floor(Date.now() / 1000) + 3600 },
  ])
    await assert.rejects(
      verifyGoogleIdentity(await token(patch), "client", "nonce", keys),
    );
});
test("forged signature is rejected", async () => {
  const forged = (await token()).split(".");
  forged[2] = (forged[2][0] === "A" ? "B" : "A") + forged[2].slice(1);
  await assert.rejects(
    verifyGoogleIdentity(forged.join("."), "client", "nonce", keys),
  );
});
function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const f of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(
      readFileSync(new URL("../drizzle/" + f, import.meta.url), "utf8"),
    );
  return {
    sqlite,
    db: {
      prepare(sql) {
        let args = [];
        return {
          bind(...v) {
            args = v;
            return this;
          },
          async first() {
            return sqlite.prepare(sql).get(...args) ?? null;
          },
        };
      },
    },
  };
}
test("OAuth flow requires same browser, expires and is consumed exactly once", async () => {
  const { db, sqlite } = database();
  const state = randomToken(),
    browser = randomToken();
  sqlite
    .prepare("INSERT INTO google_auth_flows VALUES (?,?,?,?,?)")
    .run(
      await hashToken(state),
      await hashToken(browser),
      "verifier",
      "nonce",
      2000,
    );
  assert.equal(await consumeFlow(db, state, randomToken(), 1000), null);
  assert.deepEqual(
    { ...(await consumeFlow(db, state, browser, 1000)) },
    { verifier: "verifier", nonce: "nonce" },
  );
  assert.equal(await consumeFlow(db, state, browser, 1000), null);
  sqlite
    .prepare("INSERT INTO google_auth_flows VALUES (?,?,?,?,?)")
    .run(
      await hashToken(state),
      await hashToken(browser),
      "verifier",
      "nonce",
      2000,
    );
  assert.equal(await consumeFlow(db, state, browser, 2000), null);
});
test("session tokens are hashed, expire, and revocation takes immediate effect", async () => {
  const { db, sqlite } = database();
  const raw = randomToken(),
    hash = await hashToken(raw);
  assert.notEqual(hash, raw);
  sqlite
    .prepare("INSERT INTO google_sessions VALUES (?,?,?,?,?)")
    .run(hash, "subject", "a@example.test", "Name", 2000);
  assert.equal((await readSession(db, raw, 1000)).userId, "subject");
  assert.equal(await readSession(db, raw, 2000), null);
  assert.equal(await readSession(db, randomToken(), 1000), null);
  sqlite.prepare("DELETE FROM google_sessions WHERE token_hash=?").run(hash);
  assert.equal(await readSession(db, raw, 1000), null);
});
test("production cookies are secure and ambiguous cookies are rejected", () => {
  const raw = randomToken(),
    names = cookieNames("https://event.example");
  assert.equal(names.session, "__Host-event_session");
  const cookie = authCookie(names.session, raw, 600, "https://event.example");
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
    assert.ok(cookie.includes(flag));
  assert.equal(cookieValue(cookie, names.session), raw);
  assert.equal(
    cookieValue(
      `${names.session}=${raw}; ${names.session}=${raw}`,
      names.session,
    ),
    null,
  );
});
