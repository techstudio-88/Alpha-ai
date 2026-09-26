import ToolSuite from "../../components/ToolSuite";

const schema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Alpha.ai — Video Transcript Generator",
  url: "https://alpha-ai-techstudio7808-4455.vercel.app/video-transcript",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description: "Generate a timestamped video transcript online with Alpha.ai using browser-based Whisper transcription."
};

export const metadata = {
  title: "Video Transcript Generator | Alpha.ai",
  description: "Generate a timestamped video transcript online with Alpha.ai using browser-based Whisper transcription.",
  alternates: { canonical: "/video-transcript" },
  openGraph: { title: "Video Transcript Generator | Alpha.ai", description: "Generate a timestamped video transcript online with Alpha.ai using browser-based Whisper transcription.", url: "/video-transcript", type: "website" }
};

export default function Page() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(schema)}} />
    <ToolSuite slug="video-transcript" />
  </>;
}
