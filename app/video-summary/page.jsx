import ToolSuite from "../../components/ToolSuite";

const schema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Alpha.ai — Video Summary Generator",
  url: "https://alpha-ai-techstudio7808-4455.vercel.app/video-summary",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description: "Turn the spoken content of a video into a concise summary and key points with Alpha.ai."
};

export const metadata = {
  title: "Video Summary Generator | Alpha.ai",
  description: "Turn the spoken content of a video into a concise summary and key points with Alpha.ai.",
  alternates: { canonical: "/video-summary" },
  openGraph: { title: "Video Summary Generator | Alpha.ai", description: "Turn the spoken content of a video into a concise summary and key points with Alpha.ai.", url: "/video-summary", type: "website" }
};

export default function Page() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(schema)}} />
    <ToolSuite slug="video-summary" />
  </>;
}
