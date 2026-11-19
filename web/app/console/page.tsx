"use client";
import { C } from "@/lib/copy";
import { useEffect, useRef, useState } from "react";
import { SERVER } from "@/lib/chain";
import { fmtUsd, useVaultState } from "@/lib/useVaultState";

type Line = { seq: number; t: number; layer: string; msg: string; data?: Record<string, unknown> };

const STEPS = C.console.steps;

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
          <h1 className="font-serif text-4xl">{C.console.title}</h1>
          <p className="text-sm text-muted">{C.console.sub}</p>
        </div>

        {v && (
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-line bg-card p-3 text-center text-xs">
            <div><div className="text-muted">{C.console.momVault}</div><div className="font-serif text-xl">{fmtUsd(v.balanceUsd)}</div></div>
            <div><div className="text-muted">{C.console.scammer}</div><div className={`font-serif text-xl ${scammer ? "text-stop" : ""}`}>{scammer === null ? "—" : fmtUsd(scammer)}</div></div>
            <div><div className="text-muted">{C.console.hold}</div><div className="font-serif text-xl">{Math.round(v.delaySeconds / 60)} min</div></div>
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
        <button onClick={() => { setDone({}); setNotes({}); }} className="text-xs text-muted underline">{C.console.resetSteps}</button>
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
          {lines.length === 0 && <div className="text-zinc-600">{C.console.waiting}</div>}
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
