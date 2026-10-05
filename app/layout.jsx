import "./studio.css";
import {GeistSans} from 'geist/font/sans';
import {GeistMono} from 'geist/font/mono';
import SiteBootstrap from '../components/studio/site-bootstrap';
import ProductAnalytics from "./components/ProductAnalytics";
import ClarityAnalytics from "./components/ClarityAnalytics";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://alpha-ai-smoky.vercel.app";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {default:"Alpha.ai — One long video. A week of clips.",template:"%s · Alpha.ai"},
  description: "Turn long videos into publish-ready clips with AI clipping, captions, smart reframe, editing and publishing in one workspace.",
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/favicon.svg" },
  verification: { google: "aUXmuhH0cn1r-DK266HUz1XYbPvrhk82-gY2sFEOR1c" },
  openGraph: {
    type: "website", url: SITE_URL, siteName: "Alpha.ai", images: [{url: "/og-image.svg", width: 1200, height: 630, alt: "Alpha.ai — One long video. A whole content engine."}],
    title: "Alpha.ai — One long video. A week of clips.",
    description: "Find the strongest moments in long videos, turn them into polished clips, and move from idea to publish in one workspace.",
  },
  twitter: {
    card: "summary_large_image", images: ["/og-image.svg"], title: "Alpha.ai — One long video. A week of clips.",
    description: "AI video clipping, captions, smart reframe, editing and publishing in one workspace.",
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
};
export const viewport = {themeColor:[{media:'(prefers-color-scheme: dark)',color:'#0B0C0F'},{media:'(prefers-color-scheme: light)',color:'#f5f6f7'}]};

const organizationSchema = {
  "@context": "https://schema.org", "@type": "Organization", name: "Alpha.ai",
  url: SITE_URL, description: "AI video clipping, editing and content repurposing workspace.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{__html:"try{document.documentElement.dataset.theme=localStorage.getItem('alpha.studio.theme')==='light'?'light':'dark'}catch(e){}"}}/></head>
      <body><SiteBootstrap/><a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[150] focus:bg-panel focus:p-3">Skip to content</a><ProductAnalytics /><ClarityAnalytics />
        {children}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      </body>
    </html>
  );
}
