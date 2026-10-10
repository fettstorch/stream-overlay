import { expect, test } from "bun:test";
import {
  defaultCustomModuleSettings,
  customModuleSettings,
  validateCustomModuleSettings,
  validateCustomModules,
} from "../src/config.ts";
test("custom identities and names are validated independently of source", () => {
  const module = { ...defaultCustomModuleSettings, id: "one", name: "Score" };
  for (const invalid of [
    [{ ...module, id: undefined }],
    [{ ...module, id: ".." }],
    [module, module],
    [{ ...module, name: " " }],
    [{ ...module, name: "😀".repeat(51) }],
  ])
    expect(() => validateCustomModules(invalid)).toThrow();
  expect(() =>
    validateCustomModules(Array.from({ length: 250 }, (_, id) => ({ ...module, id: String(id) }))),
  ).not.toThrow();
});
test("starter uses relative units and custom source survives normalization", () => {
  expect(defaultCustomModuleSettings.css).not.toContain("px");
  const custom = {
    ...defaultCustomModuleSettings,
    css: ".custom { left: 10px }",
    width: 1920,
    height: 1080,
  };
  expect(customModuleSettings(custom)).toEqual({ ...defaultCustomModuleSettings, css: custom.css });
});
test("Custom Module validates bounded declarative source without a fixed canvas", () => {
  expect(() => validateCustomModuleSettings(defaultCustomModuleSettings)).not.toThrow();
  for (const invalid of [
    null,
    {},
    { ...defaultCustomModuleSettings, enabled: "yes" },
    { ...defaultCustomModuleSettings, css: 7 },
    { ...defaultCustomModuleSettings, html: "x".repeat(50001) },
    { ...defaultCustomModuleSettings, css: "😀".repeat(12501) },
  ]) {
    expect(() => validateCustomModuleSettings(invalid)).toThrow();
  }
});
test("only the exact untouched legacy starter is upgraded", () => {
  const css =
    ".welcome { position: absolute; left: 80px; bottom: 80px; padding: 32px; border: 4px solid white; border-radius: 24px; background: #111c; color: white; font: 28px sans-serif; }\n.welcome h1 { margin: 0 0 12px; }\n.welcome p { margin: 0; }";
  expect(customModuleSettings({ ...defaultCustomModuleSettings, css }).css).toBe(
    defaultCustomModuleSettings.css,
  );
  expect(
    customModuleSettings({ ...defaultCustomModuleSettings, css: css + "\n.custom {}" }).css,
  ).toBe(css + "\n.custom {}");
});
