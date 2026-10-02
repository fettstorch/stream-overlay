import overlay from "./overlay.html";

const port = Number(process.env.PORT ?? 3001);

const server = Bun.serve({
  port,
  development: true,
  routes: {
    "/": overlay,
    "/overlay.html": overlay,
    "/team.json": () => new Response(Bun.file("./team.json"), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    }),
    "/badges.json": () => new Response(Bun.file("./badges.json"), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    }),
  },
});

console.log(`Overlay available at ${server.url}`);
