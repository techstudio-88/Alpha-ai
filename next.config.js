/** @type {import('next').NextConfig} */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${process.env.NODE_ENV==='development'?"'unsafe-eval' ":''}https://accounts.google.com https://*.clarity.ms https://www.googletagmanager.com https://cdn.jsdelivr.net`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.googleapis.com https://accounts.google.com https://*.clarity.ms https://*.bing.com https://www.google-analytics.com https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "frame-src https://accounts.google.com https://www.youtube.com https://www.youtube-nocookie.com",
  "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'",
].join('; ');
const nextConfig={poweredByHeader:false,compress:true,images:{formats:["image/avif","image/webp"]},async headers(){return[{source:"/(.*)",headers:[{key:"Content-Security-Policy",value:csp},{key:"Strict-Transport-Security",value:"max-age=31536000; includeSubDomains; preload"},{key:"X-Content-Type-Options",value:"nosniff"},{key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},{key:"X-Frame-Options",value:"SAMEORIGIN"},{key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"}]}]}};module.exports=nextConfig
