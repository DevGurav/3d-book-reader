// Homepage = the marketing landing page (server component, so the HTML is fully rendered for SEO).
// The reader app lives at /reader.
import { Landing } from '../components/Landing'

export const metadata = {
  title: { absolute: 'Bookie 3D — Read any PDF on a realistic 3D book' },
  description:
    'Bookie 3D is a free, in-browser PDF reader that renders your document on a realistic 3D book — '
    + 'two-page spreads, zoom into any section, Paper/Sepia/Night modes, and accessibility reflow. '
    + 'Nothing is uploaded.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Bookie 3D — Read any PDF on a realistic 3D book',
    description: 'A free, private, in-browser 3D book reader for any PDF.',
    url: '/',
    type: 'website',
  },
}

export default function Home() {
  return <Landing />
}
