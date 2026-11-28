// Copyright (c) 2025-2026 Artem Bobkin.
// SPDX-License-Identifier: MIT

/**
 * The map's WebGPU device and what it can do. Every optional feature the
 * engine has a use for is asked for when the adapter has it, and each one's
 * absence has a fallback inside WebGPU.
 */

export interface GpuCapabilities {
  /** `half` arithmetic in WGSL. */
  shaderF16: boolean;
  /** `clip_distances` in WGSL. */
  clipDistances: boolean;
  /** The depth-stencil format the engine prefers (the Metal depth32Float_stencil8). */
  depth32Stencil8: boolean;
  /** GPU pass timing. */
  timestampQuery: boolean;
  /** Block-compressed textures of desktop GPUs and of Apple and mobile GPUs. */
  textureCompressionBC: boolean;
  textureCompressionASTC: boolean;
  /** Linear filtering of float32 textures (the relief's heights). */
  float32Filterable: boolean;
  /** A first instance other than 0 in an indirect draw (the model tiles' culled draws name their record by it). */
  indirectFirstInstance: boolean;
  /** Subgroup operations in WGSL (the model tiles' triangle culling ranks by ballots). */
  subgroups: boolean;
}

export interface GpuContext {
  readonly device: GPUDevice;
  readonly adapterInfo: GPUAdapterInfo;
  readonly capabilities: GpuCapabilities;
  readonly colorFormat: GPUTextureFormat;
  readonly depthStencilFormat: GPUTextureFormat;
}

const OPTIONAL_FEATURES: GPUFeatureName[] = [
  "shader-f16",
  "clip-distances",
  "depth32float-stencil8",
  "timestamp-query",
  "texture-compression-bc",
  "texture-compression-astc",
  "float32-filterable",
  "indirect-first-instance",
  "subgroups",
];

/** The waits before each further attempt to get a device, in milliseconds: a GPU process is back within seconds. */
export const DEVICE_ATTEMPT_WAITS: readonly number[] = [250, 500, 1_000, 2_000];

/**
 * An adapter and a live device on it. A browser whose GPU process just
 * reset (a driver fault, a wake from sleep, a switch of GPU) refuses for a
 * moment: `requestAdapter` gives null or rejects ("A valid external Instance
 * reference no longer exists"), or `requestDevice` gives a device already
 * lost. Each is tried again after a wait (`waits`), on a new adapter, since
 * an adapter serves one device; the last attempt takes any adapter rather
 * than the high-performance one. Past the waits the browser's own reason is
 * thrown.
 */
export async function acquireGpuDevice(
  gpu: GPU,
  waits: readonly number[] = DEVICE_ATTEMPT_WAITS,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<{ adapter: GPUAdapter; device: GPUDevice }> {
  let failure = "ImmersiveMap found no WebGPU adapter.";
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    if (attempt > 0) await sleep(waits[attempt - 1]!);
    try {
      const adapter = await gpu.requestAdapter(attempt < waits.length || waits.length === 0 ? { powerPreference: "high-performance" } : {});
      if (!adapter) {
        failure = "ImmersiveMap found no WebGPU adapter.";
        continue;
      }
      const requiredFeatures = OPTIONAL_FEATURES.filter((f) => adapter.features.has(f));
      // The limits the engine leans on, as high as the adapter goes.
      const requiredLimits: Record<string, number> = {
        maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxTextureArrayLayers: adapter.limits.maxTextureArrayLayers,
      };
      const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
      // A stale adapter gives a device that is lost from the start: its promise is already settled.
      const lost = await Promise.race([device.lost, Promise.resolve(null)]);
      if (lost === null) return { adapter, device };
      failure = `ImmersiveMap was given a WebGPU device already lost: ${lost.message}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    console.warn(`ImmersiveMap could not get a WebGPU device (attempt ${attempt + 1} of ${waits.length + 1}): ${failure}`);
  }
  throw new Error(failure);
}

export async function createGpuContext(): Promise<GpuContext> {
  if (!navigator.gpu) throw new Error("ImmersiveMap needs WebGPU, which this browser does not provide.");
  const { adapter, device } = await acquireGpuDevice(navigator.gpu);
  device.addEventListener("uncapturederror", (event) => console.error(`ImmersiveMap WebGPU: ${(event as GPUUncapturedErrorEvent).error.message}`));
  const has = (f: GPUFeatureName) => device.features.has(f);
  const capabilities: GpuCapabilities = {
    shaderF16: has("shader-f16"),
    clipDistances: has("clip-distances"),
    depth32Stencil8: has("depth32float-stencil8"),
    timestampQuery: has("timestamp-query"),
    textureCompressionBC: has("texture-compression-bc"),
    textureCompressionASTC: has("texture-compression-astc"),
    float32Filterable: has("float32-filterable"),
    indirectFirstInstance: has("indirect-first-instance"),
    subgroups: has("subgroups"),
  };
  return {
    device,
    adapterInfo: adapter.info,
    capabilities,
    colorFormat: navigator.gpu.getPreferredCanvasFormat(),
    // depth24plus-stencil8 is core WebGPU: the fallback when the float depth is missing.
    depthStencilFormat: capabilities.depth32Stencil8 ? "depth32float-stencil8" : "depth24plus-stencil8",
  };
}
