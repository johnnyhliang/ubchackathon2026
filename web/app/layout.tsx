import { C } from "@/lib/copy";
import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const instrument = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"], axes: ["wdth"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: C.site.title,
  description: C.site.description,
};

const nav = [
  { href: "/", label: C.site.nav.story },
  { href: "/clone", label: C.site.nav.clone },
  { href: "/steal", label: C.site.nav.steal },
];
const explore = [
  { href: "/overview", label: C.site.nav.overview },
  { href: "/wallet", label: C.site.nav.wallet },
  { href: "/guardian", label: C.site.nav.guardian },
  { href: "/console", label: C.site.nav.console },
  { href: "/wallets", label: C.site.nav.wallets },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${instrument.variable} ${jetbrains.variable} font-sans antialiased`}>
        <header className="relative z-10 mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-3 px-4 pt-5">
          <nav className="flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-[#141a30]/85 px-2 py-1.5 text-sm backdrop-blur">
            <Link href="/" aria-label="Pause home" className="mr-1 grid h-8 w-8 place-items-center rounded-full bg-on-night">
              <svg width="12" height="14" viewBox="0 0 14 16" aria-hidden="true">
                <rect x="1" y="1" width="4" height="14" rx="1" fill="#0b1020" />
                <rect x="9" y="1" width="4" height="14" rx="1" fill="#0b1020" />
              </svg>
            </Link>
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-lg px-3 py-1.5 font-medium text-on-night-muted hover:bg-white/10 hover:text-on-night">
                {n.label}
              </Link>
            ))}
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-lg px-3 py-1.5 font-medium text-on-night-muted hover:bg-white/10 hover:text-on-night">{C.site.nav.explore} ▾</summary>
              <div className="absolute right-0 mt-2 w-48 rounded-xl border border-white/10 bg-[#141a30] p-1.5 shadow-xl">
                {explore.map((n) => (
                  <Link key={n.href} href={n.href} className="block rounded-lg px-3 py-1.5 text-on-night-muted hover:bg-white/10 hover:text-on-night">{n.label}</Link>
                ))}
              </div>
            </details>
          </nav>
        </header>
        <main className="relative mx-auto max-w-3xl px-4 pb-24 pt-8">{children}</main>
      </body>
    </html>
  );
}
