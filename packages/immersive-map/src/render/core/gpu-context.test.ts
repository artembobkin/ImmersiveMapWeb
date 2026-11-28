// Copyright (c) 2025-2026 Artem Bobkin.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { acquireGpuDevice } from "./gpu-context.ts";

const never = new Promise<never>(() => undefined);

function adapter(device: () => Promise<unknown>): unknown {
  return { features: new Set(), limits: {}, requestDevice: device };
}

/** A browser whose `requestAdapter` answers in turn with each of `answers`. */
function gpu(answers: (() => Promise<unknown>)[]): { gpu: GPU; options: unknown[] } {
  const options: unknown[] = [];
  let call = 0;
  return {
    options,
    gpu: {
      requestAdapter: (asked: unknown) => {
        options.push(asked);
        return answers[call++]!();
      },
    } as unknown as GPU,
  };
}

describe("acquireGpuDevice", () => {
  it("tries again after a refusal, no adapter and a device already lost", async () => {
    const live = { lost: never };
    const waited: number[] = [];
    const browser = gpu([
      () => Promise.reject(new Error("A valid external Instance reference no longer exists.")),
      () => Promise.resolve(null),
      () => Promise.resolve(adapter(() => Promise.resolve({ lost: Promise.resolve({ message: "stale" }) }))),
      () => Promise.resolve(adapter(() => Promise.resolve(live))),
    ]);
    const { device } = await acquireGpuDevice(browser.gpu, [10, 20, 40], async (milliseconds) => void waited.push(milliseconds));
    expect(device).toBe(live);
    expect(waited).toEqual([10, 20, 40]);
    // The last attempt takes any adapter.
    expect(browser.options).toEqual([{ powerPreference: "high-performance" }, { powerPreference: "high-performance" }, { powerPreference: "high-performance" }, {}]);
  });

  it("throws the browser's reason once the attempts are spent", async () => {
    const browser = gpu([() => Promise.reject(new Error("first")), () => Promise.reject(new Error("second"))]);
    await expect(acquireGpuDevice(browser.gpu, [10], async () => undefined)).rejects.toThrow("second");
  });
});
