import type { Metadata } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400" });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Pause",
  description: "A USDC wallet that calls someone you trust before a scammer gets paid.",
};

const nav = [
  { href: "/", label: "Wallet" },
  { href: "/guardian", label: "Guardian" },
  { href: "/steal", label: "Try to steal it" },
  { href: "/console", label: "Under the hood" },
  { href: "/clone", label: "Clone my voice" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${serif.variable} ${mono.variable} font-sans antialiased`}>
        <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5">
          <Link href="/" className="font-serif text-3xl tracking-tight">
            Pause<span className="text-held">.</span>
          </Link>
          <nav className="flex gap-1 text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 pb-24">{children}</main>
      </body>
    </html>
  );
}
