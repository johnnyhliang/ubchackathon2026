"use client";
import { useCallback, useEffect, useState } from "react";
import { SERVER } from "@/lib/chain";
import { fmtUsd } from "@/lib/useVaultState";

type Wallet = { name: string; role: string; address: string; balanceUsd: number; txCount: number; scammer?: boolean };
type Vault = {
  name: string; address: string; owner: string; guardian: string; balanceUsd: number;
  dailyLimitUsd: number; remainingTodayUsd: number; delaySeconds: number; actions: number; pending: number;
};
type Accounts = { chainId: number; explorer: string; usdc: string; wallets: Wallet[]; vaults: Vault[] };

export default function WalletsPage() {
  const [data, setData] = useState<Accounts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${SERVER}/accounts`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setData(j);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message || "Can't reach the Pause server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const names = new Map(data?.wallets.map((w) => [w.address.toLowerCase(), w.name]) ?? []);
  const who = (a: string) => names.get(a.toLowerCase()) ?? a;
  const total = (data?.wallets.reduce((s, w) => s + w.balanceUsd, 0) ?? 0) + (data?.vaults.reduce((s, v) => s + v.balanceUsd, 0) ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl">Wallets and vaults</h1>
          <p className="text-on-night-muted">
            Live from {data?.chainId === 5042002 ? "Arc testnet" : `chain ${data?.chainId ?? "…"}`}. {data && <>Total USDC across all of them: <b className="text-on-night">{fmtUsd(total)}</b></>}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {err && <p className="text-sm text-[#ff9b92]">{err}</p>}

      <section>
        <h2 className="mb-1 text-lg font-semibold">Wallets</h2>
        <p className="mb-3 text-sm text-on-night-muted">Ordinary accounts controlled by a private key. Whoever has the key can move the money, instantly, with no rules.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {data?.wallets.map((w) => (
            <div key={w.address} className="rounded-2xl bg-card p-4">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-semibold">{w.name}</div>
                <div className={`text-xl font-semibold ${w.scammer && w.balanceUsd >= 0.1 ? "text-stop" : ""}`}>{fmtUsd(w.balanceUsd)}</div>
              </div>
              <p className="mt-1 text-sm text-muted">{w.role}</p>
              <Addr a={w.address} explorer={data.explorer} />
              <div className="mt-1 text-xs text-muted">{w.txCount} transactions sent</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Vaults</h2>
        <p className="mb-3 text-sm text-on-night-muted">Smart contracts that hold USDC and enforce the rules. No key can take money out directly: payments go through the limit, the hold and the guardian.</p>
        <div className="grid gap-3">
          {data?.vaults.map((v) => (
            <div key={v.address} className="rounded-2xl bg-card p-5">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-lg font-semibold">{v.name}</div>
                <div className="text-2xl font-semibold">{fmtUsd(v.balanceUsd)}</div>
              </div>
              <Addr a={v.address} explorer={data.explorer} />
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 text-sm sm:grid-cols-3">
                <Item k="Owner (can request payments)" v={who(v.owner)} />
                <Item k="Guardian (can stop or approve)" v={who(v.guardian)} />
                <Item k="Instant limit per day" v={v.dailyLimitUsd ? `${fmtUsd(v.dailyLimitUsd)} (${fmtUsd(v.remainingTodayUsd)} left today)` : "None, everything is held"} />
                <Item k="Hold time" v={`${Math.round(v.delaySeconds / 60)} minutes`} />
                <Item k="Held right now" v={v.pending ? `${v.pending} waiting` : "Nothing"} />
                <Item k="Actions so far" v={String(v.actions)} />
              </dl>
            </div>
          ))}
        </div>
      </section>

      {data && (
        <p className="text-sm text-on-night-muted">
          USDC token contract: <span className="break-all">{data.usdc}</span>. On Arc, USDC also pays network fees, which is why the relayer and owner keep a small balance.
        </p>
      )}
    </div>
  );
}

function Addr({ a, explorer }: { a: string; explorer: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="break-all text-muted">{a}</span>
      <button
        onClick={() => navigator.clipboard.writeText(a).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {})}
        className="rounded-md border border-line px-2 py-0.5 text-xs"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {explorer && (
        <a href={`${explorer}/address/${a}`} target="_blank" rel="noreferrer" className="text-xs underline">
          Explorer
        </a>
      )}
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="break-words font-medium">{v}</dd>
    </div>
  );
}
