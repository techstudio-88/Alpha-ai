import ToolSuite from "../../components/ToolSuite";

export const metadata = {
  title: "Video Transcript Generator — Timestamped Transcripts | Alpha.ai",
  description: "Generate a timestamped video transcript online with Alpha.ai using browser-based Whisper transcription.",
  alternates: { canonical: "/video-transcript" },
  openGraph: { title: "Video Transcript Generator | Alpha.ai", description: "Generate timestamped transcripts from video.", url: "/video-transcript", type: "website" }
};

export default function Page() { return <ToolSuite slug="video-transcript" />; }
