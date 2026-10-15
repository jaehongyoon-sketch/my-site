"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
const responseSchema = z.object({
  isAdmin: z.boolean().optional(),
  error: z.string().optional(),
  account: z
    .object({
      id: z.string(),
      status: z.enum(["active", "closed", "suspended"]),
      createdAt: z.string(),
      displayName: z.string(),
      updatedAt: z.string().nullable(),
      nameChangedAt: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
});
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Account } from "@/lib/accounts/service";
export default function AccountPanel({
  email,
  suggestedName,
}: {
  email: string;
  suggestedName: string;
}) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState(suggestedName.slice(0, 60));
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  async function load() {
    setLoading(true);
    setReady(false);
    setError("");
    try {
      const response = await fetch("/api/account", { cache: "no-store" });
      const data = responseSchema.parse(await response.json());
      if (!response.ok)
        throw new Error(data.error ?? "Unable to load your account.");
      setReady(true);
      setAccount(data.account ?? null);
      setIsAdmin(data.isAdmin ?? false);
      setName(data.account?.displayName || suggestedName.slice(0, 60));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load your account.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function change(method: string, body: object, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/account", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = responseSchema.parse(await response.json());
      if (!response.ok)
        throw new Error(data.error ?? "Unable to save changes.");
      setAccount(data.account ?? null);
      setIsAdmin(data.isAdmin ?? false);
      setName(data.account?.displayName ?? "");
      setNotice(message);
      setConfirmOpen(false);
      if (method === "DELETE")
        window.location.assign("/account?auth=deactivated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save changes.");
    } finally {
      setBusy(false);
    }
  }
  const nextNameChange =
    !isAdmin && account?.nameChangedAt
      ? account.nameChangedAt + 7 * 24 * 60 * 60 * 1000
      : null;
  const nameLocked = Boolean(
    nextNameChange &&
    nextNameChange > Date.now() &&
    account?.status === "active",
  );
  const closed = account?.status === "closed",
    suspended = account?.status === "suspended";
  return (
    <section className="account-card" aria-busy={loading || busy}>
      <div className="account-title">
        <div>
          <p className="eyebrow">
            {account ? "YOUR PROFILE" : "FINISH SETTING UP"}
          </p>
          <h2>
            {closed
              ? "Account deactivated"
              : account
                ? "Account settings"
                : "Create your Event profile"}
          </h2>
        </div>
        <span className="account-badge">{account?.status ?? "Signed in"}</span>
      </div>
      <p className="account-caption">Signed in with Google</p>
      <p className="account-email">{email}</p>
      {loading ? (
        <p role="status">Loading your account…</p>
      ) : (
        <>
          {error && (
            <div className="account-error" role="alert">
              {error}
              <button onClick={() => void load()} disabled={busy}>
                Reload account
              </button>
            </div>
          )}
          {notice && (
            <p className="account-success" role="status">
              {notice}
            </p>
          )}
          {!suspended && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void change(
                  account ? "PATCH" : "POST",
                  account
                    ? {
                        action: closed ? "reactivate" : "update",
                        displayName: name,
                      }
                    : { displayName: name },
                  closed
                    ? "Your account is active again."
                    : account
                      ? "Profile saved."
                      : "Your Event account is ready.",
                );
              }}
            >
              {closed && (
                <p>
                  Your profile has been cleared and account features are
                  disabled. Sign in again with Google to reactivate it.
                </p>
              )}
              <label htmlFor="display-name">Display name</label>
              <Input
                id="display-name"
                autoComplete="nickname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={60}
                disabled={busy || nameLocked}
              />
              <p className="account-caption">
                1–60 characters.{" "}
                {isAdmin
                  ? "Administrators can change their name at any time."
                  : "After changing your name, you must wait 7 days to change it again."}
                {nextNameChange && nextNameChange > Date.now() && (
                  <>
                    {" "}
                    Next change available:{" "}
                    {new Date(nextNameChange).toLocaleString("en-US")}.
                  </>
                )}
              </p>
              <Button
                type="submit"
                disabled={busy || nameLocked || !name.trim() || !ready}
              >
                {busy
                  ? "Saving…"
                  : closed
                    ? "Reactivate account"
                    : account
                      ? "Save profile"
                      : "Create Event account"}
              </Button>
            </form>
          )}
          {suspended && (
            <p role="alert">
              This account is restricted. Profile changes and reactivation are
              unavailable.
            </p>
          )}
          {account && (
            <dl className="account-meta">
              <div>
                <dt>Account ID</dt>
                <dd>{account.id}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>
                  {new Date(account.createdAt).toLocaleDateString("en-US")}
                </dd>
              </div>
            </dl>
          )}
        </>
      )}
      {isAdmin && (
        <div className="account-security">
          <h3>Administrator</h3>
          <p>View registered accounts and login session counts.</p>
          <a className="account-link" href="/admin">
            Manage accounts
          </a>
        </div>
      )}
      <div className="account-security">
        <h3>Sign-in & security</h3>
        <p>
          Google manages your password and account recovery. Your Event session
          lasts up to 7 days. If your session expires, sign in again to
          continue. Signing out here does not close your Event account.
        </p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r = await fetch("/api/auth/logout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
              });
              if (!r.ok) throw new Error("Unable to sign out. Please retry.");
              window.location.assign("/account");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Unable to sign out.");
              setBusy(false);
            }
          }}
        >
          Sign out
        </Button>
      </div>
      {account?.status === "active" && (
        <div className="account-danger">
          <h3>Deactivate account</h3>
          <p>
            Clear your display name and disable your Event profile. Your account
            identifier is retained. This does not delete your Google account.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
          >
            Deactivate account
          </Button>
        </div>
      )}
      <Dialog
        open={confirmOpen}
        onOpenChange={(v) => {
          if (!busy) setConfirmOpen(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate your Event account?</DialogTitle>
            <DialogDescription>
              Your display name will be cleared. Your account identifier and
              creation date remain so you can reactivate later. Your Google
              account is unaffected.
            </DialogDescription>
          </DialogHeader>
          <Button
            disabled={busy}
            variant="destructive"
            onClick={() =>
              void change(
                "DELETE",
                { confirmation: "DEACTIVATE" },
                "Your Event account has been deactivated.",
              )
            }
          >
            {busy ? "Deactivating…" : "Confirm deactivation"}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmOpen(false)}
          >
            Keep account
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
