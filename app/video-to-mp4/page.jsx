import ToolSuite from "../../components/ToolSuite";

const schema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Alpha.ai — Video to MP4 Converter",
  url: "https://alpha-ai-techstudio7808-4455.vercel.app/video-to-mp4",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description: "Convert supported video files to MP4 in your browser with Alpha.ai. Keep your source local while the conversion runs."
};

export const metadata = {
  title: "Video to MP4 Converter | Alpha.ai",
  description: "Convert supported video files to MP4 in your browser with Alpha.ai. Keep your source local while the conversion runs.",
  alternates: { canonical: "/video-to-mp4" },
  openGraph: { title: "Video to MP4 Converter | Alpha.ai", description: "Convert supported video files to MP4 in your browser with Alpha.ai. Keep your source local while the conversion runs.", url: "/video-to-mp4", type: "website" }
};

export default function Page() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(schema)}} />
    <ToolSuite slug="video-to-mp4" />
  </>;
}
