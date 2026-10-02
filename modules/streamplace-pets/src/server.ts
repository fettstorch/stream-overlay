import petsPage from "../../../streamplace-pets/pets.html";

const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  development: true,
  routes: {
    "/": () => Response.redirect(`http://127.0.0.1:${port}/pets.html`, 302),
    "/pets.html": petsPage,
  },
});

console.log(`Streamplace Pets available at ${server.url}`);
