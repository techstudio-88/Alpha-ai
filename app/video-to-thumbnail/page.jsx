import ToolSuite from "../../components/ToolSuite";

const schema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Alpha.ai — Video to Thumbnail Maker",
  url: "https://alpha-ai-techstudio7808-4455.vercel.app/video-to-thumbnail",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description: "Create thumbnail frames from a video online with Alpha.ai. Pick useful frames from your video and download the result after signing in."
};

export const metadata = {
  title: "Video to Thumbnail Maker | Alpha.ai",
  description: "Create thumbnail frames from a video online with Alpha.ai. Pick useful frames from your video and download the result after signing in.",
  alternates: { canonical: "/video-to-thumbnail" },
  openGraph: { title: "Video to Thumbnail Maker | Alpha.ai", description: "Create thumbnail frames from a video online with Alpha.ai. Pick useful frames from your video and download the result after signing in.", url: "/video-to-thumbnail", type: "website" }
};

export default function Page() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(schema)}} />
    <ToolSuite slug="video-to-thumbnail" />
  </>;
}
