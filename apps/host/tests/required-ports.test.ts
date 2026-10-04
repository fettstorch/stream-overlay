import { expect, test } from "bun:test";
import { defaultHostConfiguration } from "../src/default-configuration.ts";
import { requiredOverlayPorts } from "../../../scripts/required-ports.ts";

test("preflight requires Pets port only while enabled, using the same defaults as the host", () => {
  expect(requiredOverlayPorts(defaultHostConfiguration).map(({ port }) => port)).toEqual([3000, 3001, 3003]);
  const configuration = structuredClone(defaultHostConfiguration);
  configuration.modules.find(module => module.id === "streamplace-pets")!.enabled = false;
  expect(requiredOverlayPorts(configuration).map(({ port }) => port)).toEqual([3001, 3003]);
  configuration.modules = [];
  expect(requiredOverlayPorts(configuration).map(({ port }) => port)).toEqual([3000, 3001, 3003]);
});

test("preflight checks the configured host port and rejects invalid or conflicting ports", () => {
  expect(requiredOverlayPorts(defaultHostConfiguration, 4000).map(({ port }) => port)).toEqual([3000, 4000, 3003]);
  for (const port of [0, -1, 65536, 1.5, NaN]) expect(() => requiredOverlayPorts(defaultHostConfiguration, port)).toThrow("integer from 1 to 65535");
  expect(() => requiredOverlayPorts(defaultHostConfiguration, 3003)).toThrow("conflicts with admin UI");
  expect(() => requiredOverlayPorts(defaultHostConfiguration, 3000)).toThrow("conflicts with Streamplace Pets");
  const configuration = structuredClone(defaultHostConfiguration);
  configuration.modules.find(module => module.id === "streamplace-pets")!.enabled = false;
  expect(requiredOverlayPorts(configuration, 3000).map(({ port }) => port)).toEqual([3000, 3003]);
});
