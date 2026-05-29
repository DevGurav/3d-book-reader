// Generates /sitemap.xml. Set NEXT_PUBLIC_SITE_URL (e.g. in Vercel) to your real domain.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookie3d.vercel.app'

export default function sitemap() {
  const now = new Date()
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/reader`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
  ]
}
