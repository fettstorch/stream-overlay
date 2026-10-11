import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
const theme = readFileSync("src/theme.css", "utf8");

test("dark theme colors copied feedback green and restores the normal color", () => {
  const style = document.createElement("style");
  style.textContent = theme;
  document.head.append(style);
  const app = document.createElement("div");
  app.id = "app";
  const button = document.createElement("button");
  button.className = "copy-button";
  app.append(button);
  document.body.append(app);
  const previousTheme = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = "dark";
  try {
    const normalColor = getComputedStyle(button).color;
    expect(normalColor).not.toBe("rgb(112, 231, 161)");
    button.classList.add("copied");
    expect(getComputedStyle(button).color).toBe("rgb(112, 231, 161)");
    button.classList.remove("copied");
    expect(getComputedStyle(button).color).toBe(normalColor);
  } finally {
    app.remove();
    style.remove();
    if (previousTheme === undefined) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = previousTheme;
  }
});
