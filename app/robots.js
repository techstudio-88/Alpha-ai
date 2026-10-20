const SITE_URL=process.env.NEXT_PUBLIC_SITE_URL||"https://alpha-ai-smoky.vercel.app";

export default function robots(){
  return {
    rules:[{
      userAgent:"*",
      allow:"/",
      disallow:[
        "/api/",
        "/adminishere/",
        "/hq-7k2p9x",
        "/hq-7k2p9x/",
        "/control-center/",
        "/editor/",
        "/shares/",
        "/publish/",
        "/content-planner/",
        "/developer/",
        "/studio","/design-system","/auth/"
      ]
    }],
    sitemap:SITE_URL+"/sitemap.xml",
    host:SITE_URL
  };
}
