import { test, expect } from "@playwright/test";

const widths = [320, 375, 768, 1280];
const routes = ["/", "/studio"];

for (const route of routes) {
  test(`no horizontal document overflow on ${route} at supported viewport widths`, async ({ page }) => {
    test.setTimeout(60_000);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      });
      await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
      const dimensions = await page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;
        const offenders = [...document.querySelectorAll("body *")]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 &&
              (rect.left < -1 || rect.right > window.innerWidth + 1) &&
              style.position !== "fixed" &&
              style.visibility !== "hidden" &&
              style.display !== "none";
          })
          .slice(0, 8)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === "string" ? element.className.slice(0, 100) : "",
              left: Math.round(rect.left),
              right: Math.round(rect.right),
            };
          });
        return {
          viewport: window.innerWidth,
          document: root.scrollWidth,
          body: body?.scrollWidth ?? 0,
          offenders,
        };
      });
      expect(
        dimensions.document <= width + 1 && dimensions.body <= width + 1,
        `Horizontal overflow at ${width}px on ${route}: ${JSON.stringify(dimensions)}`,
      ).toBeTruthy();
    }
  });
}


test("desktop account popover and theme reveal remain operable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/studio?demo=1", { waitUntil: "domcontentloaded" });
  const accountButton = page.getByRole("button", { name: "Open account menu" });
  await expect(accountButton).toBeVisible();
  await accountButton.click();
  await expect(page.locator(".account-menu-popover[role='menu']")).toBeVisible();

  const root = page.locator("html");
  const themeButton = page.getByRole("button", { name: "Switch to light theme" });
  await themeButton.click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(root).toHaveAttribute("data-theme", "dark");
});

test("mobile account menu opens as a bottom sheet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/studio?demo=1", { waitUntil: "domcontentloaded" });
  const accountButton = page.getByRole("button", { name: "Open account menu" });
  await expect(accountButton).toBeVisible();
  await accountButton.click();
  const sheet = page.locator(".dialog-content.account-sheet");
  await expect(sheet).toBeVisible();
  const position = await sheet.evaluate((element) => {
    const style = getComputedStyle(element);
    return { position: style.position, bottom: style.bottom, top: style.top, radius: style.borderTopLeftRadius };
  });
  expect(position.position).toBe("fixed");
  expect(position.bottom).toBe("0px");
  expect(position.radius).not.toBe("14px");
});
