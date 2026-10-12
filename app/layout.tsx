import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif", display: "swap", weight: ["600"] });

export const metadata: Metadata = {
  title: "Research Pulse",
  description: "Kavita's weekly AI research brief",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5fb" },
    { media: "(prefers-color-scheme: dark)", color: "#15131d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        {/* Animations: decided before first paint (no flash). Removed again after 2.5 s if the motion
            component never starts, so content can never stay hidden. Off for reduced motion. The
            landing intro plays once per tab: on a repeat visit "intro-seen" shows the page at once. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;var d=document.documentElement;if(location.pathname==='/'){var s=null;try{s=sessionStorage.getItem('rp-intro');sessionStorage.setItem('rp-intro','1')}catch(e){}if(s){d.classList.add('intro-seen');return}}d.classList.add('motion');setTimeout(function(){if(!window.__rpMotion)d.classList.remove('motion')},2500)}catch(e){}})()",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
