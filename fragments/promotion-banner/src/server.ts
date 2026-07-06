import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { promotionBannerBudget } from "./budget";
import { promotionBannerManifest } from "./manifest";
import { renderPromotionBanner } from "./render";

export function buildServer() {
  const server = Fastify({ logger: false });

  server.get("/", async (_request, reply) => {
    const demo = renderPromotionBanner({
      ctx: { locale: "en-US" },
      props: { scene: "home", campaignId: "summer" },
    });
    reply.type("text/html; charset=utf-8");
    return renderServiceHome({
      title: "promotion-banner fragment",
      port: 4201,
      sampleHtml: demo.body.html,
    });
  });
  server.get("/health", async () => ({
    status: "ok",
    service: "promotion-banner",
  }));
  server.get("/manifest", async () => promotionBannerManifest);
  server.get("/assets", async () => promotionBannerManifest.assets);
  server.get("/budget", async () => promotionBannerBudget);
  server.post("/render", async (request, reply) => {
    const result = renderPromotionBanner(
      (request.body ?? {}) as Parameters<typeof renderPromotionBanner>[0],
    );
    reply.code(result.statusCode);
    return result.body;
  });

  return server;
}

function renderServiceHome({
  title,
  port,
  sampleHtml,
}: {
  title: string;
  port: number;
  sampleHtml: string;
}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,sans-serif;margin:32px;line-height:1.5}main{max-width:760px}code{background:#f2f2f2;padding:2px 5px;border-radius:4px}section{margin:20px 0;padding:16px;border:1px solid #ddd}</style></head><body><main data-fragment-service="${title}"><h1>${title}</h1><p>This port serves an independently deployable SSR fragment service.</p><ul><li><a href="/health">/health</a></li><li><a href="/manifest">/manifest</a></li><li><a href="/assets">/assets</a></li><li><a href="/budget">/budget</a></li><li><code>POST http://localhost:${port}/render</code></li></ul><h2>Sample render</h2>${sampleHtml}</main></body></html>`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT ?? 4201);
  const server = buildServer();
  await server.listen({ host: "0.0.0.0", port });
  console.log(`promotion-banner listening on ${port}`);
}
