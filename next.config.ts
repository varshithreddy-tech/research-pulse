import type { NextConfig } from "next";
import { assertRequiredSecrets } from "./lib/requiredSecrets";

// The dashboard is public, but the cron/admin API never is: dev, build (so a Vercel deploy fails) and
// start all stop here with a clear error if CRON_SECRET is empty. (.env.local is loaded before this file.)
assertRequiredSecrets();

// Gemini reads context/*.md at runtime, so every route that can run a pipeline step
// (cron routes, admin routes, and pages whose admin buttons start a run) must ship them.
const ctx = ["./context/**/*"];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/": ctx,
    "/coverage": ctx,
    "/papers": ctx,
    "/topics": ctx,
    "/shortlist": ctx,
    "/api/daily": ctx,
    "/api/weekly": ctx,
    "/api/admin/run-daily": ctx,
    "/api/admin/make-brief": ctx,
  },
  // There is no login any more; old /login links go to the brief.
  async redirects() {
    return [{ source: "/login", destination: "/", permanent: false }];
  },
};

export default nextConfig;
