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
