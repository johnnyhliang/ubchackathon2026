"use client";
import { useCallback, useEffect, useState } from "react";
import { SERVER } from "./chain";

export type Risk = { level: "low" | "medium" | "high"; reasons: string[]; recipientTxCount: number };
export type Action = {
  vault: `0x${string}`;
  vaultName: "family" | "honeypot";
  id: string;
  kind: "Transfer" | "AddTrusted" | "RaiseLimit" | "SetGuardian";
  target: `0x${string}`;
  amountUsd: number;
  readyAt: number;
  status: "Pending" | "Approved" | "Cancelled" | "Executed";
  summary: string;
  risk?: Risk;
  txHash: string;
  cancelledTx?: string;
  executedTx?: string;
};
export type Vault = {
  address: `0x${string}`;
  balanceUsd: number;
  dailyLimitUsd: number;
  remainingTodayUsd: number;
  delaySeconds: number;
  guardian: string;
  owner: string;
};
export type Honeypot = {
  attempts: number;
  blocked: number;
  recent: { to: string; amountUsd: number; payHash: string; cancelHash: string; at: number }[];
};
export type State = {
  chainId: number;
  explorer: string;
  vaults: { family: Vault; honeypot: Vault };
  actions: Action[];
  honeypot: Honeypot;
};

export function useVaultState() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER}/state`, { cache: "no-store" });
      setState(await r.json());
      setError(null);
    } catch {
      setError("Can't reach the Pause server");
    }
  }, []);

  useEffect(() => {
    refresh();
    const es = new EventSource(`${SERVER}/stream`);
    const onAny = () => refresh();
    ["action", "instant", "honeypot", "alert"].forEach((t) => es.addEventListener(t, onAny));
    const t = setInterval(refresh, 5000);
    return () => {
      es.close();
      clearInterval(t);
    };
  }, [refresh]);

  return { state, error, refresh };
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function countdown(readyAt: number, now: number) {
  const s = Math.max(0, readyAt - now);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
