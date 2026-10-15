"use client";
import { useEffect, useState } from "react";
export default function OperationsBanner() {
  const [state, setState] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    async function update() {
      try {
        const r = await fetch("/api/operations", { cache: "no-store" });
        if (!r.ok) throw Error();
        const j = (await r.json()) as { paused: boolean };
        if (active) setState(j.paused);
      } catch {
        if (active) setState(null);
      }
    }
    void update();
    const timer = setInterval(update, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return state === false ? null : (
    <p role="status" className="account-caption">
      {state
        ? "Practice trading is paused. New orders and matching are stopped. You can still view holdings and cancel existing orders."
        : "Trading status is unavailable or loading. The server checks availability before accepting orders."}
    </p>
  );
}
