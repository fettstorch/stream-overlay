import type { HostConfiguration } from "../apps/host/src/config-store.ts";

export function requiredOverlayPorts(configuration: HostConfiguration, hostPort = 3001) {
  if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) {
    throw new Error("Overlay host PORT must be an integer from 1 to 65535");
  }
  const ports = [
    { port: hostPort, service: "public overlay host and admin URL" },
    { port: 3003, service: "admin UI" },
  ];
  if (configuration.modules.find(module => module.id === "streamplace-pets")?.enabled ?? true) {
    ports.unshift({ port: 3000, service: "Streamplace Pets" });
  }
  const conflictingService = ports.find(({ port, service }) => port === hostPort && service !== "public overlay host and admin URL");
  if (conflictingService) throw new Error(`Overlay host PORT ${hostPort} conflicts with ${conflictingService.service}`);
  return ports;
}
