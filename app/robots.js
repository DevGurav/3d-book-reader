// Generates /robots.txt. Set NEXT_PUBLIC_SITE_URL (e.g. in Vercel) to your real domain.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookie3d.vercel.app'

export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
