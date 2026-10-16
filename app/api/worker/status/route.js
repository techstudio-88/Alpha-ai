export const runtime = "nodejs";

export async function GET() {
  const configured = Boolean(String(process.env.MEDIA_WORKER_URL || "").trim());
  return Response.json(
    { configured },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
