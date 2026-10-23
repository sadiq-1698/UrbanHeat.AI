import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UrbanHeat.AI",
  description: "Climate risk & surface temperature predictor",
};

// Typed as { children: React.ReactNode } rather than the generated LayoutProps<> helper: that helper
// only exists after `next dev`/`build`, which would break `npm run typecheck` on a clean checkout.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
