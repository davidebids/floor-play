import { test, expect } from "@playwright/test";
for (const [name, viewport] of [
  ["desktop", { width: 1440, height: 1000 }],
  ["compact", { width: 656, height: 852 }],
] as const) {
  test(`scene picker supports mouse and keyboard without firing play shortcuts (${name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto("/");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__PROJECTION__?.diagnostics().assetsLoaded,
        ),
      )
      .toBe(true);
    const picker = page.getByRole("combobox", { name: "Scene", exact: true });
    await picker.click();
    const option = page.getByRole("option", { name: /Koi pond/ });
    await expect(option).toBeVisible();
    const menu = await page.locator(".scene-menu").boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.screenshot({
      path: `artifacts/qa/scene-picker-${name}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(option).toHaveCount(0);
    await expect(picker).toBeFocused();
    await picker.press("ArrowDown");
    await expect(option).toBeFocused();
    await page.keyboard.press("b");
    expect(
      await page.evaluate(
        () => (window as any).__PROJECTION__.settings().blank,
      ),
    ).toBe(false);
    await expect(
      page.getByRole("option", { name: /Butterfly meadow/ }),
    ).toBeFocused();
    // Space continues multiword typeahead; Enter selects the highlighted scene.
    await page.keyboard.press("Enter");
    await expect(option).toHaveCount(0);
    await expect(picker).toContainText("Butterfly meadow");
    expect(
      await page.evaluate(
        () => (window as any).__PROJECTION__.settings().paused,
      ),
    ).toBe(false);
    await picker.click();
    await option.click();
    await expect(option).toHaveCount(0);
    await expect(picker).toContainText("Koi pond");
    expect(errors).toEqual([]);
  });
}
