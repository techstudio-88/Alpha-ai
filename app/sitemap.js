const SITE_URL = "https://alpha-ai-techstudio7808-4455.vercel.app";

const staticPages = [
  "",
  "/about",
  "/blog",
  "/case-studies",
  "/contact",
  "/features/clipping",
  "/features/captions",
  "/features/editor",
  "/features/repurposing",
  "/glossary",
  "/performance",
  "/pricing",
  "/seo-content",
  "/templates",
  "/thumbnail",
  "/video-summary",
  "/video-to-mp3",
  "/video-to-mp4",
  "/video-to-text",
  "/video-to-thumbnail",
  "/video-transcript",
  "/tools/ai-hook-generator",
  "/tools/shorts-title-generator",
  "/tools/caption-generator",
  "/tools/clip-ideas-generator",
  "/tools/podcast-to-shorts-planner",
  "/compare/opusclip",
  "/compare/vidyo",
  "/compare/capcut",
  "/use-cases/podcasts",
  "/use-cases/youtube",
  "/use-cases/creators"
];

export default function sitemap() {
  return staticPages.map((path) => ({
    url: SITE_URL + path,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.7
  }));
}
