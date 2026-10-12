import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research Pulse",
  description: "Kavita's weekly AI/ML research brief",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
