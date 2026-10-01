import "./alpha-unified.css";
import ProductAnalytics from "./components/ProductAnalytics";
import ClarityAnalytics from "./components/ClarityAnalytics";
import StudioEnhancements from "../components/StudioEnhancements";

const SITE_URL = "https://alpha-ai-techstudio7808-4455.vercel.app";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Alpha.ai — Turn Long Videos Into Content That Gets Watched.",
  description: "Turn long videos into publish-ready clips with AI clipping, captions, smart reframe, editing and publishing in one workspace.",
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/favicon.svg" },
  verification: { google: "aUXmuhH0cn1r-DK266HUz1XYbPvrhk82-gY2sFEOR1c" },
  openGraph: {
    type: "website", url: SITE_URL, siteName: "Alpha.ai", images: [{url: "/og-image.svg", width: 1200, height: 630, alt: "Alpha.ai — One long video. A whole content engine."}],
    title: "Alpha.ai — Turn Long Videos Into Content That Gets Watched.",
    description: "Find the strongest moments in long videos, turn them into polished clips, and move from idea to publish in one workspace.",
  },
  twitter: {
    card: "summary_large_image", image: ["/og-image.svg"], title: "Alpha.ai — Turn Long Videos Into Content That Gets Watched.",
    description: "AI video clipping, captions, smart reframe, editing and publishing in one workspace.",
  },
  themeColor: "#ffffff",
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
};

const organizationSchema = {
  "@context": "https://schema.org", "@type": "Organization", name: "Alpha.ai",
  url: SITE_URL, description: "AI video clipping, editing and content repurposing workspace.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body><ProductAnalytics /><ClarityAnalytics />
        {children}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      </body>
    </html>
  );
}
