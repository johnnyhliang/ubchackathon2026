"use client";
import { useState } from "react";
import { SERVER } from "@/lib/chain";
import { fmtUsd, short, useVaultState } from "@/lib/useVaultState";
import { Card, TxLink } from "@/components/ui";

export default function StealPage() {
  const { state, refresh } = useVaultState();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("500");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  const hp = state?.honeypot;
  const v = state?.vaults.honeypot;

  async function attempt() {
    setBusy(true);
    setLast(null);
    const r = await fetch(`${SERVER}/honeypot/attempt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, amount }),
    }).then((r) => r.json());
    setBusy(false);
    setLast(r.ok ? `Your ${fmtUsd(r.amountUsd)} withdrawal went on hold and the guardian stopped it.` : r.error);
    refresh();
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-5xl leading-tight">We gave you the keys.<br />Try to steal the money.</h1>
        <p className="mt-2 text-muted">
          This wallet&apos;s owner key is in your hands: anything you send is signed by it, exactly as if you had hacked the owner.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <div className="text-xs text-muted">In the wallet</div>
          <div className="font-serif text-3xl">{v ? fmtUsd(v.balanceUsd) : "—"}</div>
        </Card>
        <Card>
          <div className="text-xs text-muted">Theft attempts</div>
          <div className="font-serif text-3xl">{hp?.attempts ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs text-muted">Stolen</div>
          <div className="font-serif text-3xl text-safe">$0</div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            placeholder="Your address (0x…)"
            className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 font-mono text-sm"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 sm:w-28"
          />
          <button onClick={attempt} disabled={busy || !to} className="rounded-xl bg-stop px-5 py-2.5 font-medium text-white disabled:opacity-40">
            {busy ? "Stealing…" : "Steal it"}
          </button>
        </div>
        {last && <p className="mt-3 text-sm">{last}</p>}
      </Card>

      {hp && hp.recent.length > 0 && (
        <Card>
          <h2 className="mb-1 font-serif text-2xl">Recent attempts</h2>
          <ul>
            {hp.recent.map((r) => (
              <li key={r.payHash} className="flex justify-between border-t border-line py-2 text-sm first:border-t-0">
                <span>
                  {fmtUsd(r.amountUsd)} to <span className="font-mono">{short(r.to)}</span>
                </span>
                <span className="text-stop">
                  stopped <TxLink hash={r.cancelHash} explorer={state!.explorer} label="proof" />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
