"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/inbox", label: "Inbox" },
  { href: "/tasks", label: "Tasks" },
  { href: "/teams", label: "Teams" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ counts }: { counts: { inbox: number; tasks: number } }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className="nav" aria-label="Primary">
      {ITEMS.map((i) => {
        const n = i.href === "/inbox" ? counts.inbox : 0;
        return (
          <Link key={i.href} href={i.href} className={active(i.href) ? "active" : ""} aria-current={active(i.href) ? "page" : undefined}>
            {i.label}
            {n > 0 && <span className="count" title="Emails awaiting review">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
