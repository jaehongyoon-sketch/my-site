"use client";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Bell,
  Bookmark,
  CircleUserRound,
  Compass,
  LayoutDashboard,
  Plus,
  Wallet,
} from "lucide-react";

export default function AppNavigation({
  admin,
  signedIn,
}: {
  admin: boolean;
  signedIn: boolean;
}) {
  const path = usePathname();
  const saved = useSearchParams().get("saved") === "1";
  const items = [
    {
      href: "/",
      label: "Explore",
      icon: Compass,
      active: (path === "/" && !saved) || path.startsWith("/events/"),
    },
    {
      href: "/?saved=1",
      label: "Saved",
      icon: Bookmark,
      active: path === "/" && saved,
    },
    {
      href: "/practice",
      label: "Portfolio",
      icon: Wallet,
      active: path.startsWith("/practice"),
    },
    {
      href: "/notifications",
      label: "Alerts",
      icon: Bell,
      active: path === "/notifications",
    },
    {
      href: "/account",
      label: signedIn ? "Account" : "Sign in",
      icon: CircleUserRound,
      active: path.startsWith("/account"),
    },
  ];
  const context =
    path.startsWith("/admin") && admin
      ? [
          ["/admin/events", "Events"],
          ["/admin/resolutions", "Outcomes"],
          ["/admin", "Members"],
          ["/admin/operations", "Controls & audit"],
          ["/admin/eligibility", "Restrictions"],
          ["/admin/providers", "Connections"],
        ]
      : path.startsWith("/practice")
        ? [
            ["/practice", "Overview"],
            ["/practice/activity", "Activity"],
            ["/practice/fees", "Fees"],
            ["/practice/events", "Order updates"],
            ["/practice/reconciliation", "Balance checks"],
          ]
        : [];
  return (
    <>
      <header className="app-topbar">
        <div className="app-topbar-inner">
          <a href="/" className="brand" aria-label="Event home">
            event<span>.</span>
          </a>
          <nav className="app-desktop-nav" aria-label="Main navigation">
            {items.map(({ icon: Icon, ...item }) => (
              <a
                key={item.label}
                href={item.href}
                aria-current={item.active ? "page" : undefined}
              >
                <Icon size={17} aria-hidden="true" />
                {item.label}
              </a>
            ))}
          </nav>
          <div className="app-topbar-end">
            <span className="practice-label">Practice mode</span>
            {admin && (
              <a className="admin-shortcut" href="/admin/events">
                <Plus size={16} aria-hidden="true" /> Create event
              </a>
            )}
          </div>
        </div>
        {admin && !path.startsWith("/admin") && (
          <nav className="app-admin-bar" aria-label="Administrator navigation">
            <a href="/admin/events">
              <LayoutDashboard size={14} aria-hidden="true" /> Event management
            </a>
            <a href="/admin">Members</a>
            <a href="/admin/resolutions">Outcomes</a>
          </nav>
        )}
        {context.length > 0 && (
          <nav className="app-context-nav" aria-label="Section navigation">
            {context.map(([href, label]) => (
              <a
                key={href}
                href={href}
                aria-current={path === href ? "page" : undefined}
              >
                {label}
              </a>
            ))}
          </nav>
        )}
      </header>
      <nav className="app-mobile-nav" aria-label="Mobile navigation">
        {items.map(({ icon: Icon, ...item }) => (
          <a
            key={item.label}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </>
  );
}
