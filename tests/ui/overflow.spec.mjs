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
