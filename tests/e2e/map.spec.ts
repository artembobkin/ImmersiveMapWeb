// Copyright (c) 2025-2026 Artem Bobkin.
// SPDX-License-Identifier: MIT

import { expect, type Page, test } from "@playwright/test";

const ARCHIVE = "/fixtures/fixtures.pmtiles";

/** Opens the e2e app at a view of the fixture archive and checks that a frame draws its tiles with no error. */
async function drawsWithoutError(page: Page, view: string, minimumTiles: number): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
  });
  await page.goto(`/?archive=${ARCHIVE}&${view}`);
  await page.waitForFunction((count) => (window as any).tileStats?.length >= count, minimumTiles, { timeout: 30_000 });
  // A frame asked for after the tiles landed draws them: the placements and their draws.
  const frame = await page.evaluate(
    () =>
      new Promise<{ draws: number; renderedTiles: number; visibleTiles: number }>((resolve) => {
        const map = (window as any).map;
        const off = map.onFrame((e: { draws: number; renderedTiles: number; visibleTiles: number }) => {
          off();
          resolve({ draws: e.draws, renderedTiles: e.renderedTiles, visibleTiles: e.visibleTiles });
        });
        map.requestFrame();
      }),
  );
  expect(frame.visibleTiles).toBeGreaterThan(0);
  expect(frame.renderedTiles).toBeGreaterThan(0);
  expect(frame.draws).toBeGreaterThan(0);
  expect(errors).toEqual([]);
}

test("the map draws the fixture tiles with no error", async ({ page }) => {
  await drawsWithoutError(page, "lon=37.6175&lat=55.752&zoom=14.2", 4);
});

test("the globe draws the fixture tiles with no error", async ({ page }) => {
  await drawsWithoutError(page, "lon=18.1&lat=48.1&zoom=2", 4);
});

test("the globe unrolling into the plane draws with no error", async ({ page }) => {
  await drawsWithoutError(page, "lon=2.35&lat=48.85&zoom=6.5", 1);
});

test("the buildings, their shadows and the trees draw under MSAA and FXAA with no error", async ({ page }) => {
  await drawsWithoutError(page, "lon=-74.011&lat=40.715&zoom=16.2&pitch=50&bearing=-60&globe=0&msaa=1&fxaa=1", 4);
});

test("the street view keeps the world's depth for the overlay with no error", async ({ page }) => {
  await drawsWithoutError(page, "lon=-74.011&lat=40.715&zoom=16.2&pitch=50&bearing=-60&globe=0", 4);
});

test("the ground relief rises on the fixture terrain with no error", async ({ page }) => {
  // The Zermatt fixtures: the map's tiles and the Mapterhorn terrain tiles, served locally.
  await drawsWithoutError(page, "lon=7.653&lat=45.977&zoom=12.3&pitch=55&bearing=-120&globe=0&relief=1&terrain=/fixtures/terrain/{z}-{x}-{y}.webp", 4);
  // On the terrain the map reads the country around the camera off the relief's heights: the Alps are mountains.
  await page.waitForFunction(() => (window as any).map.terrainSurroundings?.kind === "mountains", null, { timeout: 30_000 });
});

test("a tile worker whose script is not served stops the map being built, saying why, in place of hanging", async ({ page }) => {
  // A bundler that wrote the workers' paths where the server serves nothing, as Vite's build.lib does from the site's root.
  await page.route(/tile-worker/, (route) => route.fulfill({ status: 404, body: "not found" }));
  const error = page.waitForEvent("pageerror", { timeout: 15_000 });
  await page.goto(`/?archive=${ARCHIVE}`);
  expect((await error).message).toMatch(/tile worker's script did not load.*base/);
});

test("the map draws again on a new device after the browser took its GPU device away", async ({ page }) => {
  // Every device the page asks for, kept, so the test can take the map's away.
  await page.addInitScript(() => {
    const devices: GPUDevice[] = [];
    (window as any).gpuDevices = devices;
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (this: GPUAdapter, descriptor?: GPUDeviceDescriptor) {
      const device = await request.call(this, descriptor);
      devices.push(device);
      return device;
    };
  });
  await page.goto(`/?archive=${ARCHIVE}&lon=37.6175&lat=55.752&zoom=14.2`);
  await page.waitForFunction(() => (window as any).tileStats?.length >= 4, null, { timeout: 30_000 });
  const before = await page.evaluate(() => (window as any).map.view as { center: [number, number]; zoom: number });
  // The loss told, the renderer built again on a second device, and a frame of tiles drawn on it.
  const restored = await page.evaluate(
    () =>
      new Promise<{ restoring: boolean; devices: number }>((resolve) => {
        const map = (window as any).map;
        let restoring = false;
        map.onDeviceLost((e: { restoring: boolean }) => (restoring = e.restoring));
        map.onDeviceRestored(() => resolve({ restoring, devices: (window as any).gpuDevices.length }));
        (window as any).gpuDevices[0].destroy();
      }),
  );
  expect(restored.restoring).toBe(true);
  expect(restored.devices).toBeGreaterThanOrEqual(2);
  const frame = await page.evaluate(
    () =>
      new Promise<{ renderedTiles: number; draws: number }>((resolve) => {
        const map = (window as any).map;
        const off = map.onFrame((e: { renderedTiles: number; draws: number }) => {
          if (e.renderedTiles === 0) return map.requestFrame();
          off();
          resolve({ renderedTiles: e.renderedTiles, draws: e.draws });
        });
        map.requestFrame();
      }),
  );
  expect(frame.renderedTiles).toBeGreaterThan(0);
  expect(frame.draws).toBeGreaterThan(0);
  // The camera kept where it was.
  const after = await page.evaluate(() => (window as any).map.view as { center: [number, number]; zoom: number });
  expect(after.zoom).toBeCloseTo(before.zoom, 3);
  expect(after.center[0]).toBeCloseTo(before.center[0], 5);
  expect(after.center[1]).toBeCloseTo(before.center[1], 5);
});

test("the map starts on a GPU that refuses at first, a ring turning until its first frame", async ({ page }) => {
  // A browser whose GPU process just reset: the first two requests for an adapter are refused, as Chrome refuses them.
  await page.addInitScript(() => {
    const request = GPU.prototype.requestAdapter;
    let refusals = 2;
    GPU.prototype.requestAdapter = function (options) {
      if (refusals-- > 0) return Promise.reject(new DOMException("A valid external Instance reference no longer exists.", "OperationError"));
      return request.call(this, options);
    };
  });
  await page.goto(`/?archive=${ARCHIVE}&lon=37.6175&lat=55.752&zoom=14.2`);
  const ring = page.locator("[data-immersive-map-loading]");
  await expect(ring).toBeVisible();
  await page.waitForFunction(() => (window as any).tileStats?.length >= 1, null, { timeout: 30_000 });
  await expect(ring).toBeHidden();
});
