import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow a session to use an isolated build dir so multiple `next dev`
  // instances don't collide on the shared `.next/dev/lock`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Section roots have no page of their own; send them to the section's first screen.
  async redirects() {
    return [
      { source: "/accounts", destination: "/accounts/portfolio", permanent: false },
      { source: "/communication", destination: "/communication/crm", permanent: false },
      { source: "/knowledge", destination: "/knowledge/terminal", permanent: false },
    ];
  },
};

export default nextConfig;
