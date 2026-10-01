const SITE_URL="https://alpha-ai-techstudio7808-4455.vercel.app";

export default function robots(){
  return {
    rules:[{
      userAgent:"*",
      allow:"/",
      disallow:[
        "/api/",
        "/adminishere/",
        "/control-center/",
        "/editor/",
        "/shares/",
        "/publish/",
        "/content-planner/",
        "/developer/"
      ]
    }],
    sitemap:SITE_URL+"/sitemap.xml",
    host:SITE_URL
  };
}
