import "./globals.css";
import ProductAnalytics from "./components/ProductAnalytics";
import ClarityAnalytics from "./components/ClarityAnalytics";

const SITE_URL = "https://alpha-ai-techstudio7808-4455.vercel.app";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Alpha.ai — Turn Long Videos Into Content That Gets Watched.",
  description: "AI video clipping, captions, smart reframe, editing and publishing in one workspace.",
  alternates: {
    canonical: "/",
  },
  verification: {
    google: "aUXmuhH0cn1r-DK266HUz1XYbPvrhk82-gY2sFEOR1c",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Alpha.ai",
    title: "Alpha.ai — Turn Long Videos Into Content That Gets Watched.",
    description: "Find the strongest moments in long videos, turn them into polished clips, and move from idea to publish in one workspace.",
  },
  twitter: {
    card: "summary",
    title: "Alpha.ai — Turn Long Videos Into Content That Gets Watched.",
    description: "AI video clipping, captions, smart reframe, editing and publishing in one workspace.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Alpha.ai",
  url: SITE_URL,
  description: "AI video clipping, editing and content repurposing workspace.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body><ProductAnalytics /><ClarityAnalytics />
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
      </body>
    </html>
  );
}

