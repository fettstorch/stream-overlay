import type { HostConfiguration } from "../apps/host/src/config-store.ts";

export function requiredOverlayPorts(configuration: HostConfiguration) {
  const ports = [
    { port: 3001, service: "public overlay host and admin URL" },
    { port: 3003, service: "admin UI" },
  ];
  if (configuration.modules.find(module => module.id === "streamplace-pets")?.enabled ?? true) {
    ports.unshift({ port: 3000, service: "Streamplace Pets" });
  }
  return ports;
}
