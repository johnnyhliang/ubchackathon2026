"use client";
import { useEffect, useRef, useState } from "react";
import { SERVER } from "@/lib/chain";

export type Line = { seq: number; t: number; layer: string; msg: string; data?: Record<string, unknown> };

const LAYER_COLOR: Record<string, string> = {
  app: "text-sky-300",
  chain: "text-zinc-400",
  stream: "text-violet-300",
  risk: "text-amber-300",
  voice: "text-pink-300",
  relay: "text-cyan-300",
  contract: "text-emerald-300",
};

/** Live server log, streamed over SSE. `since` hides lines from before the page opened. */
export function Terminal({ title, className = "", fresh = false }: { title: string; className?: string; fresh?: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [expanded, setExpanded] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fresh) fetch(`${SERVER}/logs`).then((r) => r.json()).then(setLines).catch(() => {});
    const es = new EventSource(`${SERVER}/stream`);
    es.addEventListener("log", (e) => {
      const l = JSON.parse((e as MessageEvent).data) as Line;
      setLines((prev) => (prev.some((p) => p.seq === l.seq) ? prev : [...prev, l]));
    });
    return () => es.close();
  }, [fresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines]);

  return (
    <section className={`flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 font-code text-[12.5px] text-zinc-200 shadow-xl ${className}`}>
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-xs text-zinc-500">
        <span>{title}</span>
        <div className="flex gap-3">
          <button onClick={() => setExpanded((e) => !e)} className="hover:text-zinc-200">{expanded ? "hide data" : "show data"}</button>
          <button onClick={() => setLines([])} className="hover:text-zinc-200">clear</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 leading-relaxed">
        {lines.length === 0 && <div className="text-zinc-600">waiting for activity…</div>}
        {lines.map((l) => (
          <div key={l.seq} className={l.msg.startsWith("---") ? "mt-3 text-zinc-500" : ""}>
            <span className="text-zinc-600">{new Date(l.t).toLocaleTimeString([], { hour12: false })} </span>
            <span className={`${LAYER_COLOR[l.layer] ?? ""} inline-block w-20`}>{l.layer}</span>
            <span className={l.msg.includes("REVERTED") ? "text-red-400" : l.msg.includes("HELD") ? "text-amber-200" : ""}>{l.msg}</span>
            {expanded && l.data && Object.keys(l.data).length > 0 && (
              <div className="mb-1 ml-[8.5rem] border-l border-zinc-800 pl-3 text-zinc-500">
                {Object.entries(l.data).map(([k, v]) => (
                  <div key={k} className="break-all">
                    <span className="text-zinc-600">{k}:</span>{" "}
                    <span className={k === "match" ? (v ? "text-emerald-400" : "text-red-400") : ""}>
                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}
