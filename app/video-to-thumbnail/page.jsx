import ToolSuite from "../../components/ToolSuite";

export const metadata = {
  title: "Video to Thumbnail Maker — Create Video Thumbnails | Alpha.ai",
  description: "Create thumbnail frames from a video online with Alpha.ai. Pick useful frames from your video and download the result after signing in.",
  alternates: { canonical: "/video-to-thumbnail" },
  openGraph: { title: "Video to Thumbnail Maker | Alpha.ai", description: "Create thumbnail frames from your video.", url: "/video-to-thumbnail", type: "website" }
};

export default function Page() { return <ToolSuite slug="video-to-thumbnail" />; }
