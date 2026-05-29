/** @type {import('next').NextConfig} */
const nextConfig = {
  // This app is 100% client-side (no API routes / server actions), so it deploys to
  // Vercel/Netlify with zero config. To instead emit a pure-static `out/` folder for
  // any static host (S3, GitHub Pages, itch.io), uncomment the next line and run
  // `npm run build`, then serve `out/` (e.g. `npx serve out`):
  // output: 'export',
};

export default nextConfig;
