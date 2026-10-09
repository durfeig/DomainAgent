import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Arbitrage OS", description: "Analyst dashboard — domain arbitrage" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <a href="/" className="brand">Arbitrage OS</a>
          <nav>
            <a href="/">Opportunities</a>
            <a href="/runs">Runs</a>
          </nav>
          <span className="pill">Analyst · auto-buy OFF</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
