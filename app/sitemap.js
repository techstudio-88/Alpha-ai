const SITE_URL = "https://alpha-ai-techstudio7808-4455.vercel.app";

export default function sitemap() {
  const tools = [
    "video-to-text",
    "video-transcript",
    "video-to-thumbnail",
    "video-to-mp3",
    "video-to-mp4",
    "video-summary"
  ];
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    ...tools.map(slug => ({
      url: SITE_URL + "/" + slug,
      changeFrequency: "weekly",
      priority: 0.9
    }))
  ];
}
