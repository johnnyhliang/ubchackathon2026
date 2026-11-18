"use client";
import { useEffect, useRef } from "react";

/**
 * Stand-in for the hero illustration: an inked hillside neighborhood at night,
 * flat cel shading, one gold window. Swap for the commissioned art when it lands
 * by passing `src` (e.g. "/hero.png" in web/public).
 */
export function NightScene({ src, className = "" }: { src?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (src) return;
    const c = ref.current;
    if (!c) return;
    const draw = () => paint(c);
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [src]);

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" aria-hidden="true" className={`h-full w-full object-cover object-bottom ${className}`} />;
  }
  return <canvas ref={ref} aria-hidden="true" className={`block h-full w-full ${className}`} />;
}

type Pt = [number, number];
const INK = "#0a0d1c";

function paint(c: HTMLCanvasElement) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const r = c.getBoundingClientRect();
  const d = Math.min(window.devicePixelRatio || 1, 2);
  const w = r.width, h = r.height;
  c.width = w * d;
  c.height = h * d;
  const x = c.getContext("2d")!;
  x.scale(d, d);

  const ridge = (base: number, amp: number, step: number, jag: number) => {
    const pts: Pt[] = [];
    let y = base;
    for (let px = -20; px <= w + 20; px += step) {
      y += (rnd() - 0.5) * jag;
      y = Math.max(base - amp, Math.min(base + amp, y));
      pts.push([px, y]);
    }
    return pts;
  };
  const fillRidge = (pts: Pt[], fill: string, shade: string, lw: number) => {
    x.beginPath();
    x.moveTo(pts[0][0], h + 10);
    pts.forEach((p) => x.lineTo(p[0], p[1]));
    x.lineTo(pts[pts.length - 1][0], h + 10);
    x.closePath();
    x.fillStyle = fill;
    x.fill();
    x.save();
    x.clip();
    x.fillStyle = shade;
    x.beginPath();
    x.moveTo(pts[0][0], h + 10);
    pts.forEach((p, i) => x.lineTo(p[0] + 14, p[1] + 22 + (i % 3) * 6));
    x.lineTo(pts[pts.length - 1][0], h + 10);
    x.closePath();
    x.fill();
    x.restore();
    x.beginPath();
    pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])));
    x.strokeStyle = INK;
    x.lineWidth = lw;
    x.lineJoin = "round";
    x.stroke();
  };
  const cracks = (pts: Pt[], n: number) => {
    x.strokeStyle = INK;
    x.lineWidth = 1.3;
    for (let i = 0; i < n; i++) {
      const p = pts[Math.floor(rnd() * pts.length)];
      let cx = p[0], cy = p[1] + 8;
      x.beginPath();
      x.moveTo(cx, cy);
      for (let k = 0; k < 3; k++) {
        cx += (rnd() - 0.5) * 18;
        cy += 10 + rnd() * 16;
        x.lineTo(cx, cy);
      }
      x.stroke();
    }
  };
  const house = (hx: number, hy: number, s: number, lit: boolean) => {
    x.lineWidth = 2;
    x.strokeStyle = INK;
    x.lineJoin = "round";
    x.fillStyle = "#3a4f8c";
    x.beginPath(); x.rect(hx, hy, 34 * s, 24 * s); x.fill(); x.stroke();
    x.fillStyle = "#24346a";
    x.beginPath(); x.moveTo(hx - 4 * s, hy); x.lineTo(hx + 17 * s, hy - 16 * s); x.lineTo(hx + 38 * s, hy); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = lit ? "#ffcf5c" : "#1a2550";
    x.beginPath(); x.rect(hx + 6 * s, hy + 7 * s, 9 * s, 8 * s); x.fill(); x.stroke();
    x.fillStyle = "#1a2550";
    x.beginPath(); x.rect(hx + 21 * s, hy + 10 * s, 7 * s, 14 * s); x.fill(); x.stroke();
    if (lit) {
      const g = x.createRadialGradient(hx + 10 * s, hy + 11 * s, 2, hx + 10 * s, hy + 11 * s, 60 * s);
      g.addColorStop(0, "rgba(255,207,92,.35)");
      g.addColorStop(1, "rgba(255,207,92,0)");
      x.fillStyle = g;
      x.fillRect(hx - 60 * s, hy - 60 * s, 140 * s, 140 * s);
    }
  };
  const flower = (fx: number, fy: number, rr: number) => {
    x.lineWidth = 1.6;
    x.strokeStyle = INK;
    for (let k = 0; k < 5; k++) {
      const a = k * 1.2566;
      x.beginPath();
      x.ellipse(fx + Math.cos(a) * rr * 0.7, fy + Math.sin(a) * rr * 0.7, rr * 0.55, rr * 0.35, a, 0, 7);
      x.fillStyle = "#ff7d8c";
      x.fill();
      x.stroke();
    }
    x.beginPath(); x.arc(fx, fy, rr * 0.28, 0, 7); x.fillStyle = "#ffcf5c"; x.fill(); x.stroke();
  };
  const sparkle = (sx: number, sy: number, rr: number) => {
    x.fillStyle = "#cfd8ff";
    x.beginPath();
    x.moveTo(sx, sy - rr);
    x.quadraticCurveTo(sx, sy, sx + rr, sy);
    x.quadraticCurveTo(sx, sy, sx, sy + rr);
    x.quadraticCurveTo(sx, sy, sx - rr, sy);
    x.quadraticCurveTo(sx, sy, sx, sy - rr);
    x.fill();
  };

  const sky = x.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#05070f"); sky.addColorStop(0.55, "#0d1430"); sky.addColorStop(1, "#1b2752");
  x.fillStyle = sky;
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 80; i++) {
    x.fillStyle = `rgba(220,228,255,${0.25 + rnd() * 0.6})`;
    x.fillRect(rnd() * w, rnd() * h * 0.7, 1.4, 1.4);
  }
  for (let i = 0; i < 10; i++) sparkle(rnd() * w, h * 0.08 + rnd() * h * 0.5, 3 + rnd() * 4);

  x.beginPath(); x.arc(w * 0.86, h * 0.16, 26, 0, 7); x.fillStyle = "#e8edff"; x.fill(); x.lineWidth = 2; x.strokeStyle = INK; x.stroke();
  x.beginPath(); x.arc(w * 0.86 + 9, h * 0.16 - 6, 22, 0, 7); x.fillStyle = "#0b1129"; x.fill();

  const far = ridge(h * 0.66, 40, 28, 34); fillRidge(far, "#1d2b5c", "#16224a", 2); cracks(far, 8);
  const mid = ridge(h * 0.78, 30, 22, 28); fillRidge(mid, "#2b3f7a", "#213265", 2.4); cracks(mid, 14);
  [0.1, 0.2, 0.78, 0.9].forEach((t, i) => {
    const p = mid[Math.floor(t * mid.length)];
    house(p[0] - 17, p[1] - 22, 0.9, i === 2);
  });

  ([[0, 0.16], [1, 0.84]] as const).forEach(([side, edge]) => {
    const pts: Pt[] = [];
    const ex = w * edge;
    for (let y = h * 0.6; y <= h + 20; y += 22) {
      const drift = (y - h * 0.6) * 0.12 * (side ? -1 : 1);
      pts.push([ex + (rnd() - 0.5) * 26 + drift, y]);
    }
    x.lineWidth = 2.6;
    x.strokeStyle = INK;
    x.beginPath();
    x.moveTo(side ? w + 20 : -20, h * 0.52);
    pts.forEach((p) => x.lineTo(p[0], p[1]));
    x.lineTo(side ? w + 20 : -20, h + 20);
    x.closePath();
    x.fillStyle = "#34508f";
    x.fill();
    x.stroke();
    x.save();
    x.clip();
    x.fillStyle = "#7fa0e0";
    for (let k = 0; k < 6; k++) {
      const yy = h * 0.62 + k * 34;
      x.beginPath();
      x.moveTo(side ? w : 0, yy);
      x.lineTo(side ? w - 60 - rnd() * 60 : 60 + rnd() * 60, yy + 6);
      x.lineTo(side ? w : 0, yy + 18);
      x.fill();
    }
    x.restore();
  });

  x.fillStyle = "#14204a";
  x.fillRect(0, h * 0.95, w, h * 0.05);
  x.beginPath(); x.moveTo(0, h * 0.95); x.lineTo(w, h * 0.95); x.lineWidth = 2; x.strokeStyle = INK; x.stroke();
  for (let i = 0; i < 16; i++) flower(rnd() * w, h * 0.93 + rnd() * h * 0.06, 9 + rnd() * 6);
}
