"use client";
import { useEffect, useRef, useState } from "react";
import { SERVER } from "@/lib/chain";
import Link from "next/link";
import { Terminal } from "@/components/Terminal";
import { C, fill } from "@/lib/copy";

const T = C.clone;
type Result = { ok: boolean; error?: string; hash?: string };

type Phase = "consent" | "record" | "cloning" | "ready" | "attempted" | "deleted";

export default function ClonePage() {
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>("consent");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [attacking, setAttacking] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [speed, setSpeed] = useState(T.voice.speed);
  const [rate, setRate] = useState(T.voice.playbackRate);
  const [saying, setSaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceRef = useRef<string | null>(null);

  // Delete the clone if the page is closed mid-demo.
  useEffect(() => {
    const cleanup = () => {
      if (voiceRef.current) navigator.sendBeacon?.(`${SERVER}/clone/${voiceRef.current}/delete`);
    };
    window.addEventListener("beforeunload", cleanup);
    return () => {
      window.removeEventListener("beforeunload", cleanup);
      if (voiceRef.current) fetch(`${SERVER}/clone/${voiceRef.current}`, { method: "DELETE" });
    };
  }, []);

  const line = fill(T.line, { name: name || "me" });

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, audioUrl]);

  async function startRec() {
    setErr(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
    const r = new MediaRecorder(stream, { mimeType: mime });
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      upload(new Blob(chunks.current, { type: mime }));
    };
    r.start();
    rec.current = r;
    setRecording(true);
    setSeconds(0);
    timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  function stopRec() {
    if (timer.current) clearInterval(timer.current);
    setRecording(false);
    rec.current?.stop();
  }

  async function upload(blob: Blob) {
    setPhase("cloning");
    const r = await fetch(`${SERVER}/clone/create?consent=yes`, {
      method: "POST",
      headers: { "Content-Type": blob.type },
      body: blob,
    }).then((r) => r.json());
    if (!r.ok) {
      setErr(r.error);
      setPhase("record");
      return;
    }
    setVoiceId(r.voiceId);
    voiceRef.current = r.voiceId;
    setText(line);
    setPhase("ready");
    await say(r.voiceId, line);
  }

  async function say(id = voiceId, words = text) {
    if (!id) return;
    setSaying(true);
    setErr(null);
    const v = T.voice;
    const audio = await fetch(`${SERVER}/clone/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voiceId: id, text: words, model: v.model,
        settings: { speed, stability: v.stability, similarity_boost: v.similarity_boost, style: v.style, use_speaker_boost: v.use_speaker_boost },
      }),
    });
    setSaying(false);
    if (!audio.ok) return setErr(T.speechFailed);
    setAudioUrl(URL.createObjectURL(await audio.blob()));
    setTimeout(() => audioRef.current?.play().catch(() => {}), 50);
  }

  async function attack(kind: string) {
    setAttacking(kind);
    const r = await fetch(`${SERVER}/clone/attack/${kind}`, { method: "POST" }).then((r) => r.json());
    setResults((x) => ({ ...x, [kind]: r }));
    setAttacking(null);
    setPhase("attempted");
  }

  async function remove() {
    if (!voiceId) return;
    await fetch(`${SERVER}/clone/${voiceId}`, { method: "DELETE" });
    voiceRef.current = null;
    setVoiceId(null);
    setPhase("deleted");
  }

  return (
    <div className="-mx-4 grid gap-4 px-4 lg:-mx-[calc((100vw-48rem)/2-1rem)] lg:grid-cols-[26rem_1fr] lg:px-8">
      <section className="space-y-4">
        <div>
          <h1 className="font-serif text-4xl leading-tight">{T.titleLine1}<br />{T.titleLine2}</h1>
          <p className="text-sm text-muted">{T.sub}</p>
        </div>

        <Step n={1} title={T.step1} active={phase === "consent"}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={T.namePlaceholder}
            className="mb-2 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm" />
          <label className="flex gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            {T.consent}
          </label>
          {phase === "consent" && (
            <button disabled={!consent} onClick={() => setPhase("record")}
              className="mt-3 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-40">{T.continue}</button>
          )}
        </Step>

        <Step n={2} title={T.step2} active={phase === "record"}>
          <p className="rounded-xl bg-paper p-3 font-serif text-lg leading-snug">{T.script}</p>
          {phase === "record" && (
            <button onClick={recording ? stopRec : startRec}
              className="mt-3 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white">
              {recording ? fill(T.stopRecording, { seconds }) : T.startRecording}
            </button>
          )}
          {phase === "cloning" && <p className="mt-3 text-sm text-held">{T.cloning}</p>}
        </Step>

        <Step n={3} title={T.step3} active={phase === "ready"}>
          <textarea value={text || line} onChange={(e) => setText(e.target.value)} rows={3} disabled={!voiceId}
            className="w-full rounded-xl border border-line bg-paper p-2 text-sm disabled:opacity-60" />
          <p className="mt-1 text-xs text-muted">{T.tagsHint}</p>
          <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
            <label>{T.speedLabel}: {speed.toFixed(2)}
              <input type="range" min={0.7} max={1.2} step={0.05} value={speed} onChange={(e) => setSpeed(+e.target.value)} className="w-full" />
            </label>
            <label>{T.playbackLabel}: {rate.toFixed(2)}x
              <input type="range" min={0.5} max={1.5} step={0.05} value={rate} onChange={(e) => setRate(+e.target.value)} className="w-full" />
            </label>
          </div>
          {voiceId && (
            <button onClick={() => say()} disabled={saying} className="mt-2 rounded-xl border border-line px-4 py-2 text-sm disabled:opacity-50">
              {saying ? T.saying : T.say}
            </button>
          )}
          {audioUrl && <audio ref={audioRef} src={audioUrl} controls className="mt-2 w-full" />}
        </Step>

        <Step n={4} title={T.step4} active={phase === "ready" || phase === "attempted"}>
          <p className="mb-2 text-xs text-muted">{T.attacksSub}</p>
          <div className="space-y-2">
            {T.attacks.map((at) => {
              const r = results[at.key];
              return (
                <div key={at.key} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{at.label}</div>
                    <button onClick={() => attack(at.key)} disabled={!voiceId || !!attacking}
                      className="shrink-0 rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper disabled:opacity-40">
                      {attacking === at.key ? "…" : r ? "Again" : "Try"}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted">{at.desc}</p>
                  {r && (
                    <p className={`mt-1 text-xs font-medium ${r.ok ? "text-stop" : "text-safe"}`}>
                      {r.ok ? T.accepted : fill(T.rejected, { error: r.error ?? "" })}{" "}
                      {r.hash && <a className="underline" target="_blank" rel="noreferrer" href={`https://testnet.arcscan.app/tx/${r.hash}`}>Arcscan ↗</a>}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted">{T.talkToAgent} <Link href="/guardian" target="_blank" className="underline">{T.talkToAgentLink}</Link></p>
          {Object.keys(results).length > 0 && <p className="mt-2 text-sm font-medium text-safe">{T.verdict}</p>}
          {voiceId && (
            <button onClick={remove} className="mt-3 rounded-xl border border-line px-4 py-2 text-sm">{T.delete}</button>
          )}
          {phase === "deleted" && <p className="mt-2 text-sm text-safe">{T.deleted}</p>}
        </Step>

        {err && <p className="text-sm text-stop">{err}</p>}
      </section>

      <Terminal title={T.terminal} className="min-h-[70vh]" fresh />
    </div>
  );
}

function Step({ n, title, active, children }: { n: number; title: string; active: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border bg-card p-4 ${active ? "border-ink" : "border-line"}`}>
      <div className="mb-2 text-xs text-muted">Step {n}</div>
      <div className="mb-2 font-medium">{title}</div>
      {children}
    </div>
  );
}
