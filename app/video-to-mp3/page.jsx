import ToolSuite from "../../components/ToolSuite";

export const metadata = {
  title: "Video to MP3 Converter — Extract Audio Online | Alpha.ai",
  description: "Convert video to MP3 online in your browser with Alpha.ai. Extract audio without sending the source video to a conversion server.",
  alternates: { canonical: "/video-to-mp3" },
  openGraph: { title: "Video to MP3 Converter | Alpha.ai", description: "Extract MP3 audio from video in your browser.", url: "/video-to-mp3", type: "website" }
};

export default function Page() { return <ToolSuite slug="video-to-mp3" />; }
