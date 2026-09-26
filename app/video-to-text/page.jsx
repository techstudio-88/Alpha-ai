import ToolSuite from "../../components/ToolSuite";

const schema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Alpha.ai — Video to Text Converter",
  url: "https://alpha-ai-techstudio7808-4455.vercel.app/video-to-text",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description: "Convert video to text online with Alpha.ai. Get a timestamped transcript directly from your video and download or copy it after signing in."
};

export const metadata = {
  title: "Video to Text Converter | Alpha.ai",
  description: "Convert video to text online with Alpha.ai. Get a timestamped transcript directly from your video and download or copy it after signing in.",
  alternates: { canonical: "/video-to-text" },
  openGraph: { title: "Video to Text Converter | Alpha.ai", description: "Convert video to text online with Alpha.ai. Get a timestamped transcript directly from your video and download or copy it after signing in.", url: "/video-to-text", type: "website" }
};

export default function Page() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(schema)}} />
    <ToolSuite slug="video-to-text" />
  </>;
}
