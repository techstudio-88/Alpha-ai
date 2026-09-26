import ToolSuite from "../../components/ToolSuite";

export const metadata = {
  title: "Video Summary Generator — Summarize Video to Text | Alpha.ai",
  description: "Turn the spoken content of a video into a concise summary and key points with Alpha.ai.",
  alternates: { canonical: "/video-summary" },
  openGraph: { title: "Video Summary Generator | Alpha.ai", description: "Summarize video into an overview and key points.", url: "/video-summary", type: "website" }
};

export default function Page() { return <ToolSuite slug="video-summary" />; }
