import { resolve, sep } from "node:path";

const outDir = resolve(import.meta.dir, "../out");
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4173,
  async fetch(request) {
    const url = new URL(request.url);
    if (basePath && url.pathname === basePath) return Response.redirect(`${url.origin}${basePath}/`, 301);
    if (basePath && !url.pathname.startsWith(`${basePath}/`)) return new Response("Not found", { status: 404 });
    let path: string;
    try {
      path = resolve(outDir, `.${decodeURIComponent(url.pathname.slice(basePath.length))}`);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (path !== outDir && !path.startsWith(`${outDir}${sep}`)) return new Response("Not found", { status: 404 });
    if (url.pathname.endsWith("/")) path = resolve(path, "index.html");
    const file = Bun.file(path);
    if (await file.exists()) return new Response(file);
    if (await Bun.file(resolve(path, "index.html")).exists())
      return Response.redirect(`${url.origin}${url.pathname}/`, 301);
    return new Response(Bun.file(resolve(outDir, "404.html")), { status: 404 });
  },
});

console.log(`Static documentation preview: ${server.url.origin}${basePath}/`);
