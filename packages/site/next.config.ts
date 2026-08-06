import path from 'node:path';
import createMDX from '@next/mdx';
import type { NextConfig } from 'next';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';

const nextConfig: NextConfig = {
  pageExtensions: ['ts', 'tsx', 'mdx'],

  // The site lives inside a pnpm workspace; point tracing at the repo root so
  // Next stops guessing (and warning about) the lockfile location.
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // The Vite SPA is staged into `public/app` by scripts/stage-app.mjs. Static
  // assets under /app/* resolve on their own; only the bare directory URLs
  // need to be pointed at the SPA entry document.
  async rewrites() {
    return [
      { source: '/app', destination: '/app/index.html' },
      { source: '/app/', destination: '/app/index.html' },
    ];
  },
};

// `remark-gfm` adds GitHub-flavoured markdown (the documentation is full of
// tables); `rehype-slug` gives every heading a stable id so deep links work.
export default createMDX({
  options: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeSlug],
  },
})(nextConfig);
