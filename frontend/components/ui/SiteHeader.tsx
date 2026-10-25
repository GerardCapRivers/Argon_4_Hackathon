"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PixelMark } from "./PixelMark";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/coach", label: "Live coaching" },
  { href: "/create", label: "New video" },
];

/** Floating header: logo left, glass pill nav centred, rounded CTA right. Stays pinned while scrolling. */
export function SiteHeader() {
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className="sticky top-0 z-50 px-3 py-3 sm:px-6">
      {/* Frosted band behind the whole header so scrolled content never shows through the logo or CTA. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 -z-10 backdrop-blur-md transition-colors duration-300 [mask-image:linear-gradient(to_bottom,black_75%,transparent)] ${
          scrolled ? "bg-bg/80" : "bg-bg/0"
        }`}
      />
      <div className="mx-auto grid max-w-[1240px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-[-0.02em]">
          <PixelMark size={22} live />
          <span className="hidden font-mono text-[13px] uppercase leading-[1.05] tracking-[0.06em] sm:block">Pitch<br />Studio_</span>
        </Link>

        <nav
          aria-label="Main"
          className={`mx-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-white/80 bg-gradient-to-b from-white/85 to-[#ececea]/85 p-1.5 backdrop-blur-xl transition-shadow duration-300 ${
            scrolled ? "shadow-[0_12px_32px_-12px_rgb(0_0_0/0.28)]" : "shadow-[0_2px_10px_-4px_rgb(0_0_0/0.12)]"
          }`}
        >
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-xl px-3.5 py-2 font-mono text-[12.5px] uppercase tracking-[0.08em] transition-colors sm:px-5 ${
                  active ? "bg-white text-text shadow-[0_1px_4px_rgb(0_0_0/0.12)]" : "text-text/60 hover:text-text"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <Link href="/create" className="btn-mono" aria-label="New pitch video">
          <span className="hidden sm:inline">New video</span>
          <span className="arrow-ne" aria-hidden>↗</span>
        </Link>
      </div>
    </header>
  );
}
