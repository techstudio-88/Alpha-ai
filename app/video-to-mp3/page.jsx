import ToolSuite from "../../components/ToolSuite";

const schema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Alpha.ai — Video to MP3 Converter",
  url: "https://alpha-ai-techstudio7808-4455.vercel.app/video-to-mp3",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description: "Convert video to MP3 online in your browser with Alpha.ai. Extract audio without sending the source video to a conversion server."
};

export const metadata = {
  title: "Video to MP3 Converter | Alpha.ai",
  description: "Convert video to MP3 online in your browser with Alpha.ai. Extract audio without sending the source video to a conversion server.",
  alternates: { canonical: "/video-to-mp3" },
  openGraph: { title: "Video to MP3 Converter | Alpha.ai", description: "Convert video to MP3 online in your browser with Alpha.ai. Extract audio without sending the source video to a conversion server.", url: "/video-to-mp3", type: "website" }
};

export default function Page() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(schema)}} />
    <ToolSuite slug="video-to-mp3" />
  </>;
}
