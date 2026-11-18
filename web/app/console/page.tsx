"use client";
import { useEffect, useRef, useState } from "react";
import { SERVER } from "@/lib/chain";
import { fmtUsd, useVaultState } from "@/lib/useVaultState";

type Line = { seq: number; t: number; layer: string; msg: string; data?: Record<string, unknown> };

const STEPS = [
  {
    key: "trusted",
    title: "Normal day",
    what: "Mom sends $1 to her grandson.",
    why: "Trusted recipient, inside the daily limit: one call, sent instantly. Protection costs nothing for everyday use.",
  },
  {
    key: "unprotected",
    title: "Without Pause",
    what: "A scam text works. Mom sends $2 from her ordinary wallet to the scammer.",
    why: "No vault, no rules. The money reaches the scammer in one block and nobody can reverse it. Watch the scammer's balance go up.",
  },
  {
    key: "scam",
    title: "The same scam, with Pause",
    what: "Same text, same scammer. This time she sends $10 from her Pause vault.",
    why: "Unknown address, 5x the limit: the vault holds it instead of paying. The server scores the risk and alerts the guardian. The scammer's balance doesn't move.",
  },
  {
    key: "deepfake",
    title: "The deepfake",
    what: "The scammer calls with a cloned voice: \"Mom, it's me, just approve it.\"",
    why: "A voice has no key. The best the scammer can produce is a signature from some other key, and the contract recovers the signer and rejects it.",
  },
  {
    key: "cancel",
    title: "The real guardian",
    what: "Her daughter taps Stop on her own phone.",
    why: "Her device signs an EIP-712 decision; anyone can relay it. The contract checks the signer is the guardian and cancels. The money never left.",
  },
  {
    key: "swapGuardian",
    title: "The workaround",
    what: "The scammer tells Mom to make them her guardian instead.",
    why: "Weakening protection is itself held, so the current guardian sees it and cancels it too.",
  },
  {
    key: "ignored",
    title: "Nobody answers",
    what: "Another scam payment, and this time the guardian misses the alert.",
    why: "Pause buys time; it doesn't decide for you. Once the 10-minute hold runs out with no answer, the payment goes through. Run this, wait for the hold, then run it again.",
  },
  {
    key: "refund",
    title: "Reset the demo",
    what: "Send everything the scammer collected back to Mom.",
    why: "Only possible here because we hold the scammer's key. In real life, money that reaches a scammer is gone.",
  },
] as const;

const LAYER_COLOR: Record<string, string> = {
  app: "text-sky-300",
  chain: "text-zinc-400",
  stream: "text-violet-300",
  risk: "text-amber-300",
  voice: "text-pink-300",
  relay: "text-cyan-300",
  contract: "text-emerald-300",
};

export default function ConsolePage() {
  const { state, refresh } = useVaultState();
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, "ok" | "blocked" | "error" | "waiting">>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [scammer, setScammer] = useState<number | null>(null);

  async function loadScammer() {
    try {
      const j = await fetch(`${SERVER}/accounts`).then((r) => r.json());
      const s = j.wallets?.find((w: { scammer?: boolean }) => w.scammer);
      setScammer(s ? s.balanceUsd : null);
    } catch {}
  }
  useEffect(() => {
    loadScammer();
  }, []);
  const [expanded, setExpanded] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${SERVER}/logs`).then((r) => r.json()).then(setLines).catch(() => {});
    const es = new EventSource(`${SERVER}/stream`);
    es.addEventListener("log", (e) => {
      const l = JSON.parse((e as MessageEvent).data) as Line;
      setLines((prev) => (prev.some((p) => p.seq === l.seq) ? prev : [...prev, l]));
    });
    return () => es.close();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines]);

  async function run(key: string) {
    setRunning(key);
    const r = await fetch(`${SERVER}/demo/${key}`, { method: "POST" }).then((r) => r.json());
    const status = r.ok ? "ok" : r.error === "BadSignature" ? "blocked" : r.secondsLeft ? "waiting" : "error";
    setDone((d) => ({ ...d, [key]: status }));
    setNotes((n) => ({ ...n, [key]: r.ok ? "" : r.error ?? "" }));
    setRunning(null);
    refresh();
    loadScammer();
  }

  const next = STEPS.find((s) => !done[s.key])?.key;
  const v = state?.vaults.family;

  return (
    <div className="-mx-4 grid gap-4 px-4 lg:-mx-[calc((100vw-48rem)/2-1rem)] lg:grid-cols-[22rem_1fr] lg:px-8">
      <section className="space-y-3">
        <div>
          <h1 className="font-serif text-4xl">Under the hood</h1>
          <p className="text-sm text-muted">Step through a scam attempt and watch every layer react.</p>
        </div>

        {v && (
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-line bg-card p-3 text-center text-xs">
            <div><div className="text-muted">Mom&apos;s vault</div><div className="font-serif text-xl">{fmtUsd(v.balanceUsd)}</div></div>
            <div><div className="text-muted">Scammer</div><div className={`font-serif text-xl ${scammer ? "text-stop" : ""}`}>{scammer === null ? "—" : fmtUsd(scammer)}</div></div>
            <div><div className="text-muted">Hold</div><div className="font-serif text-xl">{Math.round(v.delaySeconds / 60)} min</div></div>
          </div>
        )}

        <ol className="space-y-2">
          {STEPS.map((s, i) => {
            const status = done[s.key];
            const active = s.key === next;
            return (
              <li key={s.key} className={`rounded-2xl border bg-card p-4 ${active ? "border-ink" : "border-line"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-muted">Step {i + 1}</div>
                    <div className="font-medium">{s.title}</div>
                  </div>
                  {status && status !== "waiting" ? (
                    <span className={`text-xs font-medium ${status === "error" ? "text-stop" : "text-safe"}`}>
                      {status === "blocked" ? "blocked ✓" : status === "ok" ? "done ✓" : "error"}
                    </span>
                  ) : (
                    <button
                      onClick={() => run(s.key)}
                      disabled={!!running}
                      className={`rounded-full px-3 py-1 text-xs font-medium disabled:opacity-40 ${active ? "bg-ink text-paper" : "border border-line"}`}
                    >
                      {running === s.key ? "running…" : status === "waiting" ? "Check again" : "Run"}
                    </button>
                  )}
                </div>
                <p className="mt-2 text-sm">{s.what}</p>
                {(active || status) && <p className="mt-1 text-xs text-muted">{s.why}</p>}
                {notes[s.key] && <p className={`mt-1 text-xs ${status === "waiting" ? "text-held" : "text-stop"}`}>{notes[s.key]}</p>}
              </li>
            );
          })}
        </ol>
        <button onClick={() => { setDone({}); setNotes({}); }} className="text-xs text-muted underline">Reset steps</button>
      </section>

      <section className="flex min-h-[70vh] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 font-code text-[12.5px] text-zinc-200 shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-xs text-zinc-500">
          <span>pause-server · chain {state?.chainId ?? "…"} · live</span>
          <div className="flex gap-3">
            <button onClick={() => setExpanded((e) => !e)} className="hover:text-zinc-200">{expanded ? "hide data" : "show data"}</button>
            <button onClick={() => setLines([])} className="hover:text-zinc-200">clear</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 leading-relaxed">
          {lines.length === 0 && <div className="text-zinc-600">waiting for activity… run step 1</div>}
          {lines.map((l) => (
            <div key={l.seq} className={l.msg.startsWith("---") ? "mt-3 text-zinc-500" : ""}>
              <span className="text-zinc-600">{new Date(l.t).toLocaleTimeString([], { hour12: false })} </span>
              <span className={`${LAYER_COLOR[l.layer] ?? ""} inline-block w-20`}>{l.layer}</span>
              <span className={l.msg.includes("REVERTED") ? "text-red-400" : l.msg.includes("HELD") ? "text-amber-200" : ""}>{l.msg}</span>
              {expanded && l.data && Object.keys(l.data).length > 0 && <DataBlock data={l.data} />}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </section>
    </div>
  );
}

function DataBlock({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="mb-1 ml-[8.5rem] border-l border-zinc-800 pl-3 text-zinc-500">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="break-all">
          <span className="text-zinc-600">{k}:</span>{" "}
          <span className={k === "match" ? (v ? "text-emerald-400" : "text-red-400") : ""}>
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}
