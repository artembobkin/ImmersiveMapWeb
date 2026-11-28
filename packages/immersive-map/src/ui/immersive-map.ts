// Copyright (c) 2025-2026 Artem Bobkin.
// SPDX-License-Identifier: MIT

/**
 * The map's renderer: everything that draws on the map's canvas, composed
 * the way the Swift `RenderFrameEngine` and the runtimes of the Swift view
 * compose them: the tiles under their stencil priority on the globe, through
 * its unroll and on the plane (one continuous morph by the presentation's
 * transition), the sky, the camera, the gestures and the render loop. The
 * app holds the map (`ImmersiveMap`, `immersive-map-host.ts`), which builds
 * a renderer, applies settings to it in place, and builds it again for a
 * change that needs it, as the Swift host recreates its renderer.
 *
 * Rendering is on demand (`RenderLoopDriver`): a frame is drawn when the
 * camera moves, a tile lands, an animation runs or the app asks for one.
 */

import { GroundFogUniform } from "../ground-fog/ground-fog-uniform.ts";
import { clearPreparedTileDatabase } from "../tile/loading/prepared-tile-cache.ts";
import { groundFlatteningGrid, resolvedGroundFlatteningFromTileZoom, resolvedMaximumZoomLevel } from "../configuration/tile-settings.ts";
import { TileArchiveDepths } from "../tile/loading/archive-depths.ts";
import { initFrameWasm } from "../frame/frame-wasm.ts";
import type { ImmersiveMapCameraPosition } from "../camera/immersive-map-camera-position.ts";
import { writeGpuCameraUniform, CAMERA_UNIFORM_BYTE_LENGTH } from "../camera/camera-uniform.ts";
import { RenderCamera } from "../camera/render-camera.ts";
import { AnimatedZoom } from "../camera/animated-zoom.ts";
import { airHandover } from "../configuration/presentation-settings.ts";
import { GlobeFrameConstants } from "../globe/globe-frame-constants.ts";
import { GlobeFrameUniformLayout, writeGlobeFrameUniform } from "../globe/globe-frame-uniform.ts";
import { GlobeLight } from "../globe/globe-light.ts";
import { GlobeCapSubsystem, GlobeVectorSurfaceSubsystem } from "../globe/globe-render-subsystems.ts";
import { GlobeSunDirection } from "../globe/globe-sun-direction.ts";
import { type Mat4, mat4Multiply } from "../math/matrix.ts";
import { SphereTilePipelines } from "../tile/pipelines/tile-sphere-pipeline.ts";
import { ImmersiveMapSettings } from "../configuration/immersive-map-settings.ts";
import { type GpuContext, createGpuContext } from "../render/core/gpu-context.ts";
import { frameClearColor } from "../render/frame-clear-color.ts";
import { type FrameSetup, FrameEngine } from "../render/frame-engine.ts";
import type { SceneFrameState } from "../render/scene-frame-state.ts";
import type { ResolvedPresentationState } from "../presentation/resolved-presentation-state.ts";
import { HorizonRenderSubsystem } from "../horizon/horizon-render-subsystem.ts";
import { StarfieldRenderSubsystem } from "../starfield/starfield-render-subsystem.ts";
import { themeBaseColors } from "../style/theme.ts";
import { OVERVIEW_FADE_BYTES, writeOverviewFade } from "../tile/drawers/flat-map-surface-drawer.ts";
import { defaultMaxConcurrentDiskLoads, TileLoader } from "../tile/loading/tile-loader.ts";
import { labelAtlasGlyphs, type LabelAtlasGlyphs, preparedTileCacheNamespace, tileParserConfig } from "../tile/loading/tile-parser-config.ts";
import { bundledOverviewURL } from "../tile/overview/overview-tile-source.ts";
import { PlacementPipeline } from "../tile/pipelines/placement-pipeline.ts";
import { FlatTilePipelines } from "../tile/pipelines/tile-pipeline.ts";
import { BuildingCoveragePlanner } from "../tile/placement/building-coverage-planner.ts";
import { RasterTilePipeline } from "../tile/raster/raster-tile-pipeline.ts";
import { RasterTileSubsystem } from "../tile/raster/raster-tile-subsystem.ts";
import { makeMapTile, type MapTile } from "../tile/store/map-tile.ts";
import { TileWorkingSetStore } from "../tile/store/tile-working-set-store.ts";
import { type TilePlacementState, TileWorkingSet } from "../tile/store/working-set.ts";
import { FlatMapSurfaceSubsystem, PlacementStencilSubsystem, type TileFrameState } from "../tile/subsystems/flat-tile-subsystems.ts";
import { type Tile, tileKey } from "../tile/tile.ts";
import { FrameVisibilityResolver } from "../tile/visibility/frame-visibility-resolver.ts";
import { TileCoverageZoomPolicy } from "../tile/visibility/tile-coverage-zoom-policy.ts";
import { type DownloadHandle, WorkerTilePipeline } from "../worker/pool.ts";
import type { PreparedTilePayload } from "../worker/protocol.ts";
import { ImmersiveMapCameraController } from "./camera/immersive-map-camera-controller.ts";
import { createImmersiveMapCameraRuntimes, type ImmersiveMapCameraRuntimes } from "./camera/immersive-map-camera-runtimes.ts";
import { ControlZones } from "./control-zone/control-zones.ts";
import { MapGestureController } from "./gestures/map-gesture-controller.ts";
import { cameraPositionFromOption, type FrameEvent, type ImmersiveMapCameraOption, makeFrameEvent, type MapView, viewFromCameraPosition } from "./immersive-map-view.ts";
import { RenderLoopDriver } from "./render-loop-pacing.ts";
import type { CameraFrameState } from "../camera/frame-camera-state-resolver.ts";
import { LabelGpu } from "../labels/drawers/label-gpu.ts";
import { BaseLabelPrepare, type LabelFrameInput } from "../labels/subsystems/base-label-prepare.ts";
import { type LabelDrawFrame, ScreenLabelSubsystem, type SurfaceLabelFrame, SurfaceLabelSubsystem } from "../labels/subsystems/label-render-subsystems.ts";
import { labelOpacityFrame } from "../style/theme.ts";
import type { PlaceTile } from "../tile/placement/place-tile.ts";
import type { VisibleContentState } from "../tile/visibility/visible-content-state.ts";
import { planRenderFrameOutput } from "../render/core/render-frame-output-plan.ts";
import { PostProcessingSubsystem } from "../render/post-processing/post-processing-subsystem.ts";
import { GroundShadowMaskSubsystem } from "../shadows/ground-shadow-mask-subsystem.ts";
import { ShadowFrameRuntime } from "../shadows/shadow-frame-runtime.ts";
import { themeTreePalette } from "../style/theme.ts";
import { StandingPipelines } from "../tile/pipelines/standing-pipelines.ts";
import { BuildingExtrusionSubsystem } from "../tile/subsystems/building-extrusion-subsystem.ts";
import { StandingFrame, type StandingFrameState } from "../tile/subsystems/standing-frame.ts";
import { TreeSubsystem } from "../tile/subsystems/tree-subsystem.ts";
import { TreeModelStore } from "../tile/trees/tree-model-store.ts";
import { GroundReliefGpu } from "../tile/relief/frame/ground-relief-gpu.ts";
import { GroundReliefRuntime } from "../tile/relief/ground-relief-runtime.ts";
import { GroundReliefShadowCasterSubsystem } from "../tile/relief/frame/ground-relief-shadow-caster-subsystem.ts";
import type { GroundReliefFrame } from "../tile/relief/frame/ground-relief-frame.ts";
import { type ImmersiveMapTerrainSurroundings, terrainSurroundingsEqual } from "../tile/relief/lifts/terrain-surroundings.ts";
import { GroundReliefURLTerrainSource, type GroundReliefTerrainResponse } from "../tile/relief/store/ground-relief-terrain-source.ts";
import { GroundReliefOcclusionGpu } from "../tile/relief/store/ground-relief-occlusion-gpu.ts";
import { ImmersiveMapSelectionHandler } from "../selection/immersive-map-selection-handler.ts";
import type { ImmersiveMapScreenPoint, ImmersiveMapSelectionController } from "../selection/immersive-map-selection.ts";
import type { SelectableMapFeature, SelectionPickData } from "../selection/selectable-map-feature.ts";
import { ImmersiveMapLayersController } from "../layers/immersive-map-layers-controller.ts";
import type { ImmersiveMapLayerTapEvent } from "../layers/immersive-map-layer-tap-event.ts";
import type { LayerFrame } from "../layers/layer-render-subsystem.ts";
import { ImmersiveMapLayerRuntime, layerFrameOf } from "./immersive-map-layer-runtime.ts";
import type { ImmersiveMapTileGridController } from "../tile-grid/immersive-map-tile-grid-controller.ts";
import { makeTileGridAtlas, type TileGridAtlas, type TileGridAtlasSource } from "../tile-grid/tile-grid-atlas.ts";
import type { TileGridRenderFrame } from "../tile-grid/tile-grid-render-subsystem.ts";
import { ImmersiveMapTileGridRuntime, tileGridFrameOf } from "./immersive-map-tile-grid-runtime.ts";
import { ImmersiveMapPinsController } from "../pins/immersive-map-pins-controller.ts";
import { loadPinShapeResource, PinsGpu, type PinShapeResource } from "../pins/drawers/pins-gpu.ts";
import { PinsRenderer } from "../pins/pins-renderer.ts";
import { type PinFrameInput, PinRenderSubsystem } from "../pins/pin-render-subsystem.ts";
import { type ImmersiveMapPinTapEvent, PinSelection } from "../pins/selection/pin-selection.ts";
import { ImmersiveMapAnnotations } from "../annotations/immersive-map-annotations.ts";
import { AttributionBadge } from "./attribution/attribution-badge.ts";
import { ImmersiveMapModelRuntime } from "./immersive-map-model-runtime.ts";
import type { ImmersiveMapSceneModelsController } from "../scene-models/immersive-map-scene-models-controller.ts";
import type { ImmersiveMapSceneModelTapEvent } from "../scene-models/immersive-map-scene-model-tap-event.ts";
import type { SceneModelFrameInput } from "../scene-models/scene-model-render-subsystem.ts";
import type { ModelTileFrameInput } from "../scene-models/model-tiles/model-tile-render-subsystem.ts";
import { GeoScreenProjectionFrameConstants } from "../geo/geo-screen-projection-math.ts";
import type { FrameCameraStateResolver } from "../camera/frame-camera-state-resolver.ts";
import type { MapPresentationStateController } from "../presentation/map-presentation-state-controller.ts";
import type { ImmersiveMapCameraRuntime } from "./camera/immersive-map-camera-runtime.ts";
import { ImmersiveMapCameraControlPanel } from "./camera/immersive-map-camera-control-panel.ts";
import type { ImmersiveMapTourVideoRecorder } from "../export/immersive-map-tour-video-recorder.ts";
import { type ImmersiveMapStillCaptureOptions, type ImmersiveMapStillEncoding, ImmersiveMapStillRecorder } from "../export/immersive-map-still-recorder.ts";
import type { ImmersiveMapDebugFrameHooks } from "./immersive-map-debug-panel.ts";
import type { DebugFrameReport, DebugLabelBox } from "../render/debug/debug-frame-report.ts";
import type { LabelDebugBox } from "../labels/subsystems/base-label-prepare.ts";
import type { TileLoaderStatusObserver } from "../tile/loading/tile-loader.ts";
import { TileTraceLoaderObserver, type TileTraceRecorder } from "../render/debug/tile-trace-recorder.ts";

export interface ImmersiveMapOptions {
  /** The element the map's canvas fills. */
  readonly container: HTMLElement;
  /** `ImmersiveMapSettings.default` when left out. */
  readonly settings?: ImmersiveMapSettings;
  /** A PMTiles archive in place of the settings' (`ImmersiveMapSettings.tileArchive`), resolved against the page. */
  readonly url?: string;
  /** Where the camera opens, the renderer's own start (Moscow's centre) when left out. */
  readonly camera?: ImmersiveMapCameraOption;
  /** The app's camera controller, a new one when left out (`ImmersiveMap.camera`). */
  readonly cameraController?: ImmersiveMapCameraController;
  /** Tile workers, each with its own Wasm instance. The cores less one, two to eight, when left out. */
  readonly workers?: number;
  /** The app's selection controller, none when left out (`ImmersiveMap.selection`). */
  readonly selection?: ImmersiveMapSelectionController | null;
  /** The app's layers of its own data, a new controller when left out (`ImmersiveMap.layers`). */
  readonly layers?: ImmersiveMapLayersController;
  /** The app's handle on the tile grid, which also shows the grid: none when left out (`ImmersiveMap.tileGrid`). */
  readonly tileGrid?: ImmersiveMapTileGridController | null;
  /** The app's pins controller, a new one when left out (`ImmersiveMap.pins`). */
  readonly pins?: ImmersiveMapPinsController;
  /** The app's 3D models (glTF, GLB or OBJ at coordinates), a new controller when left out (`ImmersiveMap.sceneModels`). */
  readonly sceneModels?: ImmersiveMapSceneModelsController;
  /**
   * The on-screen camera panel (rotate and tilt buttons and sliders, the
   * Swift `enableCameraUIControls`), off when left out. Hidden with the
   * controls (`ImmersiveMapSettings.controls`).
   */
  readonly cameraControls?: boolean | { readonly isEnabled?: boolean; readonly maximumPitch?: number };
  /** The recorder whose tour exports draw this map's settings, camera, pins, layers and annotations (`ImmersiveMap.tourVideoRecorder`). */
  readonly tourVideoRecorder?: ImmersiveMapTourVideoRecorder | null;
  /**
   * The ring that turns in the middle of the container while the map starts
   * and while it builds its renderer again after a lost GPU device
   * (`LoadingIndicator`), shown when left out. `false` for an app that shows
   * its own.
   */
  readonly loadingIndicator?: boolean;
}

/**
 * @internal How an export's map draws: offscreen, at its own size and scale,
 * by its own scene clock, each frame drawn when the export asks for it
 * (`ImmersiveMap.createOffscreen`).
 */
export interface OffscreenMapRendering {
  /** The frame's size in pixels. */
  readonly width: number;
  readonly height: number;
  /** How many pixels a point is: what the labels and the pins are sized by. */
  readonly pixelsPerPoint: number;
  /** The scene clock in seconds: the frames are not bound to real time. */
  readonly now: () => number;
  /** Something asked for a frame: a tile, the terrain, a layer or a picture landed. */
  readonly onFrameRequested: () => void;
}

/** @internal What an offscreen frame left to settle (the Swift export's diagnostics counters and activity state). */
export interface OffscreenFrameReport {
  /** Whether the frame was drawn at all. */
  readonly drawn: boolean;
  readonly requestedTiles: number;
  readonly pendingTerrainTiles: number;
  readonly pendingLayerMeshes: number;
  readonly pendingSceneModelMeshes: number;
  readonly labelFadeActive: boolean;
  readonly pinAnimationActive: boolean;
  readonly extrusionRiseActive: boolean;
  readonly animatedZoomActive: boolean;
  /** The frame's projection, for what an export draws over it (the annotations). */
  readonly projection: GeoScreenProjectionFrameConstants | undefined;
}

/**
 * @internal What the map hands the renderer it builds beside the app's
 * options: the canvas and the annotations it keeps across renderers, and the
 * archive depth's report, which the map applies as settings.
 */
export interface ImmersiveMapRendererOptions extends ImmersiveMapOptions {
  /** The canvas to draw into, a new one in the container when left out. */
  readonly canvas?: HTMLCanvasElement;
  /** The annotations over the canvas, kept by the map across renderers, new ones when left out. */
  readonly annotationsController?: ImmersiveMapAnnotations;
  /** Built again for new settings: the disk cache is not cleared as on launch. */
  readonly isRecreation?: boolean;
  /**
   * The archive's header named a depth other than the one the settings
   * planned by: the settings resolved with it, for the map to apply. Left
   * out, the renderer rebuilds its tiles itself.
   */
  readonly onArchiveDepthChange?: (settings: ImmersiveMapSettings) => void;
  /** The debug panel's side of the frame (`ImmersiveMapDebugFrameHooks`), none without a panel. */
  readonly debugHooks?: ImmersiveMapDebugFrameHooks;
  /** The browser took the GPU device away: the renderer has stopped, for the map to build another (`DeviceRecovery`). */
  readonly onDeviceLost?: (info: { readonly reason: string; readonly message: string }) => void;
}

type ImmersiveMapBuildOptions = ImmersiveMapRendererOptions & { readonly offscreen?: OffscreenMapRendering };

/** A tile that landed on the GPU, as `ImmersiveMap.onTileLoaded` reports it. */
export interface TileLoadedEvent {
  readonly tile: Tile;
  /** What its arena takes on the GPU. */
  readonly gpuBytes: number;
  /** The worker's parse, `undefined` for a tile the prepared cache served. */
  readonly parseMilliseconds: number | undefined;
}

/** The label atlases, whose code points the parser keeps the names to. */
const labelAtlasURLs = [new URL("../../assets/atlas.json", import.meta.url).href, new URL("../../assets/atlas_thin.json", import.meta.url).href];

/** What the main thread reads of the label atlases' metrics: the code points they carry, and each weight's atlas texels per em. */
interface LabelAtlasMetrics {
  readonly glyphs: number[];
  readonly emTexels: { readonly bold: number; readonly thin: number };
  /** The bold atlas's glyphs as the tile grid writes its texts with them. */
  readonly tileGrid: TileGridAtlas;
}

async function fetchLabelAtlasMetrics(): Promise<LabelAtlasMetrics> {
  const [bold, thin] = await Promise.all(
    labelAtlasURLs.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`ImmersiveMap could not load its label atlas ${url}: HTTP ${response.status}`);
      return (await response.json()) as LabelAtlasGlyphs & TileGridAtlasSource;
    }),
  );
  return { glyphs: labelAtlasGlyphs([bold!, thin!]), emTexels: { bold: bold!.atlas.size, thin: thin!.atlas.size }, tileGrid: makeTileGridAtlas(bold!) };
}

const defaultWorkerCount = (): number => Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));

export class ImmersiveMapRenderer {
  readonly canvas: HTMLCanvasElement;
  /** The camera's commands (jump, fly, follow) and callbacks. */
  readonly camera: ImmersiveMapCameraController;
  /** The DOM elements the app stands on coordinates (`annotations.set`, `annotations.clear`). */
  readonly annotations: ImmersiveMapAnnotations;

  private readonly abort = new AbortController();
  private readonly attributionBadge: AttributionBadge;
  private readonly frameListeners = new Set<(event: FrameEvent) => void>();
  private readonly tileListeners = new Set<(event: TileLoadedEvent) => void>();
  private readonly resizeObserver: ResizeObserver;
  private readonly loop: RenderLoopDriver;
  private readonly controlZones: ControlZones;
  private readonly cameraRuntimes: ImmersiveMapCameraRuntimes;
  private readonly gestures: MapGestureController;
  private loader!: TileLoader<DownloadHandle>;
  private store!: TileWorkingSetStore<MapTile>;
  private workingSet!: TileWorkingSet<MapTile>;
  /** The archive depths kept across sessions (`TileArchiveDepths`), and the archive's key among them. */
  private readonly archiveDepths = new TileArchiveDepths();
  private readonly archiveRevision: string;
  /** A rebuild of the tiles under a corrected archive depth, while one runs. */
  private rebuilding: Promise<void> | undefined;
  private readonly visibility = new FrameVisibilityResolver();
  private readonly engine: FrameEngine;
  private readonly pipelines: FlatTilePipelines;
  private readonly cameraBuffer: GPUBuffer;
  private readonly overviewFadeBuffer: GPUBuffer;
  private readonly groundFogBuffer: GPUBuffer;
  private readonly groundFogStaging = new Float32Array(GroundFogUniform.byteLength / 4);
  private readonly globeBuffer: GPUBuffer;
  private readonly globeStaging = new Float32Array(GlobeFrameUniformLayout.byteLength / 4);
  private readonly gpuCameraMatrix: Mat4 = new Float64Array(16);
  /** The tile pipelines' frame group, built again when a shadow texture is made again. */
  private frameBindGroupState: { generation: number; group: GPUBindGroup } | undefined;
  private readonly buildingFogStaging = new Float32Array(GroundFogUniform.byteLength / 4);
  /** The shadows: the windows, the gate, the map and the ground's mask (`ShadowFrameRuntime`). */
  private readonly shadows: ShadowFrameRuntime;
  private readonly standingFrame: StandingFrame;
  private readonly buildings: BuildingExtrusionSubsystem;
  private readonly trees: TreeSubsystem;
  private readonly treeModels: TreeModelStore;
  private readonly postProcessing: PostProcessingSubsystem;
  /** What the buildings and the trees read of the frame being drawn. */
  private standingState: StandingFrameState;
  private readonly cameraStaging = new Float32Array(CAMERA_UNIFORM_BYTE_LENGTH / 4);
  private readonly overviewFadeStaging = new Float32Array(OVERVIEW_FADE_BYTES / 4);
  private readonly frameSetup: FrameSetup;
  /** Every tile on the GPU by `tileKey`, to destroy its buffer once the store let it go. */
  private readonly gpuTiles = new Map<string, MapTile>();
  /** A worker's parse time for a tile about to materialize. */
  private readonly parseTimes = new Map<string, number>();
  private storeReleased = false;
  private tileState: TileFrameState;
  /** What the starfield and the horizon read of the frame being drawn. */
  private sceneState: SceneFrameState | undefined;
  private readonly rasterTiles: RasterTileSubsystem;
  private readonly placementStencil: PlacementStencilSubsystem;
  private readonly globeCaps: GlobeCapSubsystem;
  /** The labels' GPU resources and the frame's label decisions, `undefined` with the labels off. */
  private readonly labelGpu: LabelGpu | undefined;
  private readonly labelPrepare: BaseLabelPrepare | undefined;
  /** What the label subsystems read of the frame being drawn. */
  private labelInput: Omit<LabelFrameInput, "buildingRise" | "buildingRiseSignature"> | undefined;
  private labelDraw: LabelDrawFrame | undefined;
  private surfaceLabelFrame: SurfaceLabelFrame | undefined;
  /** The globe's constants of the frame being drawn, for the labels' projection on the sphere. */
  private globeConstants: GlobeFrameConstants | undefined;
  private frameNumber = 0;
  /** The ground relief's GPU side, whose group every flat ground pipeline's layout carries. */
  private readonly reliefGpu: GroundReliefGpu;
  /** The ground relief, `undefined` with it off (`GroundReliefSettings.isEnabled`). */
  private readonly relief: GroundReliefRuntime | undefined;
  private readonly occlusionGpu: GroundReliefOcclusionGpu | undefined;
  private reliefCasters: GroundReliefShadowCasterSubsystem | undefined;
  private readonly surroundingsListeners = new Set<(surroundings: ImmersiveMapTerrainSurroundings | null) => void>();
  private lastSurroundings: ImmersiveMapTerrainSurroundings | null = null;
  /** The render camera the terrain follow was given to: a new camera gets it again. */
  private followedCamera: object | undefined;
  private lastFrameTime: number | undefined;
  private lastCameraJumpCount = 0;
  /** The camera's zoom followed over time (`AnimatedZoom`): what dresses the frame by the zoom (the air, the shadows) reads it. */
  private readonly animatedZoom = new AnimatedZoom();
  private currentSettings: ImmersiveMapSettings;
  private readonly workerCount: number;
  private destroyed = false;
  /**
   * The selectable features, in the order a tap asks them (the ones drawn
   * over the others first: the pins, then the layers), and what each drew
   * in the last frame, handed to the selection after the frame's submit.
   */
  private readonly selectableFeatures: SelectableMapFeature[] = [];
  private readonly pickDataProviders: (() => SelectionPickData | null)[] = [];
  private readonly selectionHandler: ImmersiveMapSelectionHandler;
  /** The app's own data drawn over the map (`ImmersiveMapLayersController`): `map.layers.register(...)`. */
  readonly layers: ImmersiveMapLayersController;
  private readonly layerRuntime: ImmersiveMapLayerRuntime;
  /** What the layers read of the frame being drawn. */
  private layerFrame: LayerFrame | undefined;
  private readonly tileGridRuntime: ImmersiveMapTileGridRuntime;
  /** What the tile grid reads of the frame being drawn. */
  private tileGridFrame: TileGridRenderFrame | undefined;
  /** The app's pins (`ImmersiveMapPinsController`): `map.pins.set([...])`. */
  readonly pins: ImmersiveMapPinsController;
  private readonly pinsGpu: PinsGpu;
  private readonly pinsRenderer: PinsRenderer;
  private readonly pinSelection: PinSelection;
  private readonly pinTapListeners = new Set<(event: ImmersiveMapPinTapEvent) => void>();
  private readonly sceneModelTapListeners = new Set<(event: ImmersiveMapSceneModelTapEvent) => void>();
  /** What the pins read of the frame being drawn. */
  private pinFrame: PinFrameInput | undefined;
  /** The 3D models: the app's scene models and the model archive's (`ImmersiveMapModelRuntime`). */
  private readonly models: ImmersiveMapModelRuntime;
  /** What the models read of the frame being drawn. */
  private sceneModelFrame: Omit<SceneModelFrameInput, "shadowFrameState"> | undefined;
  private modelTileFrame: Omit<ModelTileFrameInput, "shadowFrameState"> | undefined;
  /** How an export's map draws, `undefined` for a map on screen. */
  private readonly offscreen: OffscreenMapRendering | undefined;
  /** What the last offscreen frame left to settle. */
  private offscreenReport: OffscreenFrameReport | undefined;
  /** The on-screen camera panel (`ImmersiveMapOptions.cameraControls`). */
  private readonly cameraControlPanel: ImmersiveMapCameraControlPanel | undefined;
  private attachedTourVideoRecorder: ImmersiveMapTourVideoRecorder | null = null;
  /** Whether the canvas and the annotations are this renderer's own, or the map's kept across renderers. */
  private readonly ownsCanvas: boolean;
  private readonly ownsAnnotations: boolean;
  /** The archive depth's report to the map (`ImmersiveMapRendererOptions.onArchiveDepthChange`). */
  private readonly onArchiveDepthChange: ((settings: ImmersiveMapSettings) => void) | undefined;
  /** The debug panel's side of the frame, `undefined` without a panel. */
  private readonly debugHooks: ImmersiveMapDebugFrameHooks | undefined;
  private tracingObserver: { readonly recorder: TileTraceRecorder; readonly observer: TileTraceLoaderObserver } | undefined;

  /** Builds the renderer in `options.container`: resolves once the GPU and the tile workers are ready. */
  static create(options: ImmersiveMapRendererOptions): Promise<ImmersiveMapRenderer> {
    return ImmersiveMapRenderer.build(options);
  }

  /**
   * @internal A map drawn offscreen for an export (the Swift still and video
   * runtimes' headless engine): its canvas stays out of the document, its
   * loop never runs, and each frame is drawn by `renderOffscreenFrame` at the
   * export's scene time. Its own GPU device and tile workers, so the map on
   * screen keeps its state and stays interactive.
   */
  static createOffscreen(options: Omit<ImmersiveMapOptions, "container">, rendering: OffscreenMapRendering): Promise<ImmersiveMapRenderer> {
    return ImmersiveMapRenderer.build({ ...options, container: document.createElement("div"), offscreen: rendering });
  }

  private static async build(options: ImmersiveMapBuildOptions): Promise<ImmersiveMapRenderer> {
    let settings = options.settings ?? ImmersiveMapSettings.default;
    if (options.url !== undefined) settings = settings.tileArchive(options.url, settings.tiles.network.tileRequestHeaders);
    // The frame Wasm module (the planner) loads beside the GPU and the glyphs.
    const [gpu, atlasMetrics] = await Promise.all([createGpuContext(), fetchLabelAtlasMetrics(), initFrameWasm()]);
    const glyphs = atlasMetrics.glyphs;
    // The coverage plans by the archive's depth as last read (the Swift `resolvingArchiveDepth`).
    settings = settings.resolvingArchiveDepth(new TileArchiveDepths().maximumZoom(archiveRevisionOf(settings)));
    // An export's map shares the disk cache of the map on screen and never
    // clears it, and a renderer built again for new settings is no launch.
    if (settings.tiles.cache.clearDiskCachesOnLaunch && options.offscreen === undefined && options.isRecreation !== true) await clearPreparedTileDatabase();
    const workers = makeWorkerPipeline(settings, glyphs, options.workers ?? defaultWorkerCount());
    let map: ImmersiveMapRenderer | undefined;
    try {
      const sampleCount = settings.postProcessing.multisampleCount > 1 ? 4 : 1;
      const pipelineContext = { device: gpu.device, colorFormat: gpu.colorFormat, depthStencilFormat: gpu.depthStencilFormat, sampleCount };
      const pipelines = new FlatTilePipelines(pipelineContext);
      const reliefEnabled = settings.tiles.groundRelief.isEnabled;
      const spherePipelines = new SphereTilePipelines(pipelineContext, pipelines, gpu.capabilities.clipDistances);
      const standingPipelines = new StandingPipelines(pipelineContext, pipelines.drawLayout);
      // The pins' shape (the bubble's field, or a mask's picture) loads with the rest.
      const pinShape = await loadPinShapeResource(settings.pins);
      const [rasterPipeline, labelGpu, pinsGpu] = await Promise.all([
        RasterTilePipeline.create(pipelineContext, pipelines, settings.tiles.rasterization, gpu.capabilities.clipDistances),
        // The labels' atlases and pipelines, none with the labels off.
        settings.data.labels.isEnabled
          ? LabelGpu.create({ ...pipelineContext, clipDistances: gpu.capabilities.clipDistances, tileFrameLayout: pipelines.frameLayout, drawLayout: pipelines.drawLayout })
          : Promise.resolve(undefined),
        PinsGpu.create(gpu, settings.pins, pinShape),
        pipelines.prewarm(reliefEnabled),
        spherePipelines.prewarm(),
        standingPipelines.prewarm(),
        workers.ready,
      ]);
      map = new ImmersiveMapRenderer(options, settings, gpu, pipelines, spherePipelines, standingPipelines, rasterPipeline, sampleCount, workers, glyphs, labelGpu, atlasMetrics.emTexels, atlasMetrics.tileGrid, { gpu: pinsGpu, shape: pinShape });
      return map;
    } catch (error) {
      if (map) map.destroy();
      else {
        workers.destroy();
        gpu.device.destroy();
      }
      throw error;
    }
  }

  private constructor(
    options: ImmersiveMapBuildOptions,
    settings: ImmersiveMapSettings,
    private readonly gpu: GpuContext,
    pipelines: FlatTilePipelines,
    spherePipelines: SphereTilePipelines,
    standingPipelines: StandingPipelines,
    rasterPipeline: RasterTilePipeline,
    sampleCount: number,
    private workers: WorkerTilePipeline,
    private readonly glyphs: readonly number[],
    labelGpu: LabelGpu | undefined,
    private readonly atlasEmTexels: { readonly bold: number; readonly thin: number },
    tileGridAtlas: TileGridAtlas,
    pinResources: { readonly gpu: PinsGpu; readonly shape: PinShapeResource },
  ) {
    this.currentSettings = settings;
    this.workerCount = options.workers ?? defaultWorkerCount();
    this.archiveRevision = archiveRevisionOf(settings);
    const { device } = gpu;
    // The map keeps its canvas across renderers: a renderer built again draws into it.
    const canvas = options.canvas ?? document.createElement("canvas");
    this.ownsCanvas = options.canvas === undefined;
    if (this.ownsCanvas) canvas.style.cssText = "display:block;width:100%;height:100%;cursor:grab";
    this.offscreen = options.offscreen;
    // An export's canvas is never laid out: its drawable is the export's size.
    if (options.offscreen !== undefined) [canvas.width, canvas.height] = [options.offscreen.width, options.offscreen.height];
    if (canvas.parentElement !== options.container) options.container.append(canvas);
    this.canvas = canvas;
    this.debugHooks = options.debugHooks;
    this.onArchiveDepthChange = options.onArchiveDepthChange;
    // The overlays (the annotations, the attribution badge) are placed
    // absolutely over the canvas: a static container is made their
    // containing block, and an app's own positioning is kept.
    if (getComputedStyle(options.container).position === "static") options.container.style.position = "relative";
    this.ownsAnnotations = options.annotationsController === undefined;
    this.annotations = options.annotationsController ?? new ImmersiveMapAnnotations(canvas, () => this.requestFrame());
    this.attributionBadge = new AttributionBadge(canvas, settings);
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("ImmersiveMap could not get a WebGPU context for its canvas.");

    // The GPU: the frame engine, the tile pipelines and the frame uniforms (group 0).
    this.engine = new FrameEngine(gpu, context, settings.scene.space.isTransparent);
    this.pipelines = pipelines;
    this.cameraBuffer = device.createBuffer({ label: "camera", size: CAMERA_UNIFORM_BYTE_LENGTH, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.overviewFadeBuffer = device.createBuffer({ label: "overview fade", size: OVERVIEW_FADE_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.groundFogBuffer = device.createBuffer({ label: "ground fog", size: GroundFogUniform.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.globeBuffer = device.createBuffer({ label: "globe", size: GlobeFrameUniformLayout.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.shadows = new ShadowFrameRuntime(device);
    // The ground relief: the terrain store, its frame state and its GPU side
    // (the occlusion of the sky is computed on the GPU).
    this.occlusionGpu = settings.tiles.groundRelief.isEnabled ? new GroundReliefOcclusionGpu(device) : undefined;
    const occlusionGpu = this.occlusionGpu;
    this.reliefGpu = new GroundReliefGpu(device, pipelines.reliefLayout, occlusionGpu === undefined ? undefined : (heights, tile, key) => occlusionGpu.compute(heights, tile, key));
    this.engine.registerFlush(() => this.reliefGpu.flush());
    this.engine.register({ name: "GroundRelief", layers: [], encode: () => undefined, frameCommitted: () => this.reliefGpu.frameCommitted() });
    if (settings.tiles.groundRelief.isEnabled) {
      const relief = settings.tiles.groundRelief;
      // A relative template is resolved against the page (`WorkerTilePipeline.loadTerrain`).
      const source = new GroundReliefURLTerrainSource(relief.source.tileURLTemplate, relief.source.encoding, {
        loadTerrain: async (tile, request, signal): Promise<GroundReliefTerrainResponse> => {
          const result = await this.workers.loadTerrain(tile, { tileURLTemplate: request.tileURLTemplate, encoding: request.encoding }, signal);
          if (result.kind === "missing") return result;
          return { kind: "heights", heights: { size: result.size, halves: result.halves, minMetres: result.minMetres, maxMetres: result.maxMetres } };
        },
      });
      this.relief = new GroundReliefRuntime(settings, source, this.reliefGpu);
      this.relief.store.invalidate = () => {
        if (!this.destroyed) this.loop.requestFrame("tileAvailable");
      };
    }
    const placement = new PlacementPipeline(device, {
      colorFormat: gpu.colorFormat,
      depthStencilFormat: gpu.depthStencilFormat,
      sampleCount,
      frameLayout: pipelines.frameLayout,
      drawLayout: pipelines.drawLayout,
      clipDistances: gpu.capabilities.clipDistances,
      reliefLayout: pipelines.reliefLayout,
    });
    const flattening = settings.tiles.groundFlattening;
    this.tileState = { placements: [], renderSurfaceMode: "flat", flatRenderState: { pan: [0, 0], renderMapSize: 1 }, globe: { panX: 0, panY: 0, radius: 1, transition: 1 } };
    this.standingState = { placements: [], renderSurfaceMode: "flat", flatRenderState: this.tileState.flatRenderState, timeSeconds: 0, projectionView: new Float64Array(16) };
    const tileState = (): TileFrameState => this.tileState;
    const standingState = (): StandingFrameState => this.standingState;
    const sceneState = (): SceneFrameState | undefined => this.sceneState;
    const sceneGpu = { device, colorFormat: gpu.colorFormat, depthStencilFormat: gpu.depthStencilFormat, sampleCount };
    this.engine.register(new StarfieldRenderSubsystem(sceneGpu, settings.scene.starfield, sceneState));
    // The ground's shadow mask, in its own pass after the shadow map's.
    this.engine.register(new GroundShadowMaskSubsystem(device, this.shadows.resources));
    // What stands on the flat map: the buildings, then the trees in their
    // layer. Their frame group carries the camera, the fogs and the shadows.
    this.standingFrame = new StandingFrame(device, standingPipelines, this.cameraBuffer, this.groundFogBuffer, this.shadows, GroundFogUniform.byteLength);
    // The models before the buildings: the buildings leave out the ones a
    // drawn model stands in for, and wait for the model tiles on their way.
    this.models = new ImmersiveMapModelRuntime({
      gpu,
      pipeline: pipelineContextOf(gpu, sampleCount),
      standingPipelines,
      standingFrame: this.standingFrame,
      settings: () => this.settings,
      controller: options.sceneModels,
      sceneModelFrame: () => ({ ...this.sceneModelFrame!, shadowFrameState: this.shadows.resolvedFrameState }),
      modelTileFrame: () => ({ ...this.modelTileFrame!, shadowFrameState: this.shadows.resolvedFrameState }),
      requestFrame: () => {
        if (!this.destroyed) this.loop.requestFrame("sceneModelAssetLoaded");
      },
      syncSelection: () => {
        this.selectionHandler.handleFeatureDidChange();
      },
    });
    this.models.register(this.engine);
    this.buildings = new BuildingExtrusionSubsystem(device, standingPipelines, this.standingFrame, settings.scene.extrusion, standingState, {
      state: this.models.state,
      isLive: (resident) => this.gpuTiles.get(tileKey(resident.tile))?.gpu === resident.gpu,
    });
    this.engine.register(this.buildings);
    // Before the ground of either surface: the planner's decision in the stencil.
    this.placementStencil = new PlacementStencilSubsystem(device, placement, tileState, this.reliefGpu, flattening);
    this.engine.register(this.placementStencil);
    // The far rings' textures, then the vector ground, on either surface:
    // each source paints the ground its mark names, in whatever order.
    this.rasterTiles = new RasterTileSubsystem(device, rasterPipeline, tileState, () => themeBaseColors(this.settings.data.mapStyle.theme).map, this.reliefGpu, flattening);
    this.engine.register(this.rasterTiles);
    this.engine.register(new FlatMapSurfaceSubsystem(pipelines, tileState, this.reliefGpu));
    // The mountains' shadows, into the shadow map's windows as the buildings'.
    if (this.relief !== undefined) {
      this.reliefCasters = new GroundReliefShadowCasterSubsystem(device, pipelines.drawLayout, this.reliefGpu, flattening, tileState, () => this.shadows.frameState);
      this.engine.register(this.reliefCasters);
    }
    // After the ground's subsystem: the trees' shadow discs lie over the roads.
    this.treeModels = new TreeModelStore(device, () => this.loop.requestFrame("sceneModelAssetLoaded"));
    this.trees = new TreeSubsystem(
      device,
      standingPipelines,
      this.standingFrame,
      this.treeModels,
      settings.scene.trees,
      settings.scene.extrusion.riseSeconds,
      () => this.settings.scene.light,
      () => themeTreePalette(this.settings.data.mapStyle.theme),
      standingState,
    );
    this.engine.register(this.trees);
    this.engine.register(new GlobeVectorSurfaceSubsystem(spherePipelines, tileState));
    // The layers of the app's data, in a render layer of their own (`appLayers`).
    this.layerRuntime = new ImmersiveMapLayerRuntime({
      controller: options.layers,
      pipeline: { ...pipelineContextOf(gpu, sampleCount), clipDistances: gpu.capabilities.clipDistances, frameLayout: pipelines.frameLayout, drawLayout: pipelines.drawLayout },
      frame: () => this.layerFrame,
      hasSelectionController: () => this.selectionHandler.selectionController !== null,
      requestFrame: () => {
        if (!this.destroyed) this.loop.requestFrame("layerDataLoaded");
      },
      syncSelection: () => this.selectionHandler.syncSelectionWithAvailableObjects(),
      fixedLayers: options.offscreen !== undefined,
    });
    this.layers = this.layerRuntime.controller;
    this.engine.register(this.layerRuntime.subsystem);
    this.globeCaps = new GlobeCapSubsystem(pipelineContextOf(gpu, sampleCount), pipelines, tileState, () => themeBaseColors(this.settings.data.mapStyle.theme));
    this.engine.register(this.globeCaps);
    this.engine.register(new HorizonRenderSubsystem(sceneGpu, sceneState));
    // The labels: the names painted on the map in the world pass, and the
    // screen labels, decided on the CPU after the buildings' rise (the roofs
    // they stand on) and drawn in the overlay.
    this.labelGpu = labelGpu;
    if (labelGpu !== undefined) {
      // On the relief the road names' paths are cut at the flattening's grid, as the roads are.
      const flattensFrom = settings.tiles.groundRelief.isEnabled ? resolvedGroundFlatteningFromTileZoom(settings.tiles) : null;
      this.labelPrepare = new BaseLabelPrepare(settings.data.labels, (zoom) =>
        flattensFrom === null || zoom < flattensFrom ? undefined : 4096 / groundFlatteningGrid(settings.tiles.groundFlattening, zoom),
      );
      this.engine.register(new SurfaceLabelSubsystem(labelGpu, () => this.surfaceLabelFrame));
      const labelInput = (): LabelFrameInput | undefined =>
        this.labelInput === undefined ? undefined : { ...this.labelInput, buildingRise: this.buildings.riseCoverage, buildingRiseSignature: this.buildings.riseSignature };
      this.engine.register(new ScreenLabelSubsystem(labelGpu, this.labelPrepare, labelInput, () => this.labelDraw));
    }
    // The tile grid, in the overlay over the map's names and under the
    // pins. An export's map shows none: the grid is a tool of the screen.
    this.tileGridRuntime = new ImmersiveMapTileGridRuntime({
      controller: options.offscreen === undefined ? (options.tileGrid ?? null) : null,
      pipeline: { device, colorFormat: gpu.colorFormat, clipDistances: gpu.capabilities.clipDistances, cameraBuffer: this.cameraBuffer, globeBuffer: this.globeBuffer },
      atlas: tileGridAtlas,
      labelAtlasTexture: () => this.labelGpu?.boldAtlas,
      settings: () => this.settings.tileGrid,
      frame: () => this.tileGridFrame,
      requestFrame: () => {
        if (!this.destroyed) this.loop.requestFrame("externalStateChanged");
      },
    });
    this.engine.register(this.tileGridRuntime.subsystem);
    this.postProcessing = new PostProcessingSubsystem(device, gpu.colorFormat, () => this.engine.postProcessingInput);
    this.engine.register(this.postProcessing);
    this.frameSetup = {
      availability: {
        renderSurfaceMode: "flat",
        labelsEnabled: false,
        pinsEnabled: false,
        debugOverlayEnabled: false,
        starfieldEnabled: !settings.scene.space.isTransparent,
        sceneModelsEnabled: false,
        appLayersEnabled: false,
        tileGridEnabled: false,
      },
      clearColor: { r: 0, g: 0, b: 0, a: 0 },
      sampleCount,
      fxaa: planRenderFrameOutput(settings.postProcessing.fxaaEnabled, sampleCount).includesPostProcessingPass,
    };

    // The render loop, the camera and the gestures (the Swift view's runtime graph).
    const offscreen = options.offscreen;
    this.loop = new RenderLoopDriver({
      configuration: settings.renderLoop,
      renderFrame: (now) => this.drawFrame(now),
      // An export's map draws when the export asks: its loop is told of the
      // requests and never scheduled.
      ...(offscreen === undefined
        ? {}
        : { scheduler: { requestAnimationFrame: () => 0, cancelAnimationFrame: () => undefined }, now: offscreen.now, onFrameRequested: offscreen.onFrameRequested }),
    });
    this.controlZones = new ControlZones(settings.camera.controlZones, settings.controls.isHidden);
    this.camera = options.cameraController ?? new ImmersiveMapCameraController();
    this.cameraRuntimes = createImmersiveMapCameraRuntimes({
      settings,
      initialCameraPosition: options.camera === undefined ? null : cameraPositionFromOption(options.camera),
      cameraController: this.camera,
      render: this.loop,
      controls: this.controlZones,
      viewportSize: () => (offscreen === undefined ? [canvas.clientWidth, canvas.clientHeight] : [offscreen.width / offscreen.pixelsPerPoint, offscreen.height / offscreen.pixelsPerPoint]),
      ...(offscreen === undefined ? {} : { now: offscreen.now }),
    });
    this.controlZones.attach(this.cameraRuntimes);
    const cameraControls = options.cameraControls === true ? {} : options.cameraControls === false ? undefined : options.cameraControls;
    if (cameraControls !== undefined && cameraControls.isEnabled !== false && offscreen === undefined) {
      this.cameraControlPanel = new ImmersiveMapCameraControlPanel({
        container: options.container,
        camera: this.camera,
        ...(options.camera === undefined ? {} : { initialCameraPosition: cameraPositionFromOption(options.camera) }),
        ...(cameraControls.maximumPitch === undefined ? {} : { maximumPitch: cameraControls.maximumPitch }),
      });
      // Hidden with the controls, and shown again in place (`ControlsSettings.isHidden`).
      this.cameraControlPanel.setEnabled(!settings.controls.isHidden);
    }
    this.gestures = new MapGestureController({
      surface: canvas,
      host: this.cameraRuntimes,
      controlZones: this.controlZones,
      onTap: (point) => this.handleMapTap({ x: point[0], y: point[1] }),
      isTapClaimed: (kind) => this.selectionHandler.isClaimed(kind),
      onClaimedTap: (kind, point) => this.handleClaimedTap(kind, { x: point[0], y: point[1] }),
    });
    this.selectionHandler = new ImmersiveMapSelectionHandler(
      {
        get contentsScale(): number {
          return canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : devicePixelRatio;
        },
        requestFrame: () => this.requestFrame(),
      },
      this.selectableFeatures,
    );
    this.selectionHandler.syncController(options.selection ?? null);

    // The pins: the renderer over the controller (the Swift
    // `ImmersiveMapPinRuntime`), drawn in the overlay over the labels, and
    // the first of the features a tap asks.
    this.pinsGpu = pinResources.gpu;
    this.pinsRenderer = new PinsRenderer(settings.pins, pinResources.gpu, pinResources.shape);
    this.engine.register(new PinRenderSubsystem(this.pinsRenderer, () => this.pins, () => this.pinFrame));
    this.pins = options.pins ?? new ImmersiveMapPinsController();
    this.pins.setChangeHandler(() => {
      if (this.destroyed) return;
      this.selectionHandler.handleFeatureDidChange();
      this.loop.requestFrame("externalStateChanged");
    }, this);
    this.pins.markSnapshotDirty();
    const pins = this.pins;
    this.pinSelection = new PinSelection({ pin: (id) => pins.pin(id), updatePinSelection: (id, isSelected) => pins.update(id, { isSelected }) });
    this.pinSelection.tapAction = (event) => {
      for (const listener of this.pinTapListeners) listener(event);
    };
    this.selectableFeatures.unshift(this.pinSelection);
    this.pickDataProviders.push(() => this.pinsRenderer.selectionSnapshot.withFrameIndex(this.frameNumber));
    // The layers, after the pins: a pin over a shape takes the tap first.
    // The scene models after the pins and before the layers, as the Swift graph orders them.
    this.models.selection.tapAction = (event) => {
      for (const listener of this.sceneModelTapListeners) listener(event);
    };
    this.selectableFeatures.push(this.models.selection);
    this.pickDataProviders.push(() => this.models.pickData());
    this.selectableFeatures.push(this.layerRuntime.selection);
    this.pickDataProviders.push(() => this.layerRuntime.pickData());
    // The grid lies on the ground under everything else: the last a tap asks.
    this.selectableFeatures.push(this.tileGridRuntime.selection);
    this.pickDataProviders.push(() => this.tileGridRuntime.pickData());

    this.startTiles(workers);

    // The drawable follows the canvas's size in device pixels.
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      [canvas.width, canvas.height] = drawableSize(entry, devicePixelRatio);
      this.controlZones.layout(canvas.clientWidth, canvas.clientHeight);
      this.loop.requestFrame();
    });
    // An export's canvas keeps the export's size: a detached element reports a zero box.
    if (options.offscreen === undefined) observeDrawableSize(this.resizeObserver, canvas);
    // A hidden page parks the loop, and showing it again draws what accumulated.
    document.addEventListener("visibilitychange", () => this.loop.setParked(document.hidden), { signal: this.abort.signal });
    this.loop.setParked(document.hidden);
    void device.lost.then((info) => {
      if (this.destroyed) return;
      console.error(`ImmersiveMap lost its WebGPU device: ${info.message}`);
      this.loop.stop();
      options.onDeviceLost?.({ reason: info.reason ?? "unknown", message: info.message });
    });
    if (options.tourVideoRecorder) this.tourVideoRecorder = options.tourVideoRecorder;
    this.loop.requestFrame();
  }

  /** The tiles: the loader over the workers, the store whose residents hold the GPU tiles, the working set over both. */
  private startTiles(workers: WorkerTilePipeline): void {
    const network = this.settings.tiles.network;
    this.loader = new TileLoader<DownloadHandle>(workers, {
      maxConcurrentFetches: network.maxConcurrentFetches,
      pendingRequestQueueCapacity: network.pendingRequestQueueCapacity,
      maxConcurrentPrepares: this.settings.tiles.parsing.maximumConcurrentParses,
      maxConcurrentDiskLoads: defaultMaxConcurrentDiskLoads,
    });
    this.loader.onFrameNeeded = () => this.loop.requestFrame("tileRetryDue");
    workers.onParsed = (tile, timings) => this.parseTimes.set(tileKey(tile), timings.parse);
    workers.materialize = (tile, prepared) => this.materialize(tile, prepared);
    this.store = new TileWorkingSetStore<MapTile>({
      byteSize: (resident) => resident.gpu.byteLength,
      trace: (event) => {
        if (event.kind === "release" || event.kind === "removeAll" || (event.kind === "insert" && event.replaced)) this.storeReleased = true;
      },
    });
    this.workingSet = new TileWorkingSet<MapTile>({
      store: this.store,
      loader: this.loader,
      terrainDemand: this.relief?.store,
      buildingsMinimumTileZoom: BuildingCoveragePlanner.minimumDrawZoom(this.settings),
    });
    workers.onArchiveDepth = (maxZoom) => {
      if (this.destroyed || !this.archiveDepths.observe(maxZoom, this.archiveRevision)) return;
      const next = this.settings.resolvingArchiveDepth(maxZoom);
      // Only a depth that moves the planning rebuilds anything, as the Swift
      // settings planner decides: a first session that read the depth it
      // assumed keeps its workers.
      // The map applies the depth as settings, which the planner reads.
      if (this.onArchiveDepthChange !== undefined) this.onArchiveDepthChange(next);
      else if (resolvedMaximumZoomLevel(next.tiles.coverage) === resolvedMaximumZoomLevel(this.settings.tiles.coverage)) this.currentSettings = next;
      else this.rebuildTiles(next);
    };
  }

  /**
   * The archive turned out deeper or shallower than the depth the map was
   * planned by: the coverage, the parse (the buildings' deepest zoom, the
   * ground flattening) and the disk cache's namespace all follow it, so the
   * workers and every tile are rebuilt under the corrected settings, as the
   * Swift host re-applies its settings on `TileArchiveDepths.didChange`.
   * The map takes this path too for a settings change that only the tile
   * workers read (`resolveSettingsRebuild`): the style's prepared part, the
   * parse, the cache and the overview, live settings applied with it.
   *
   * Nothing goes blank meanwhile. The new workers start while the old ones
   * keep the map going (on a tablet a worker takes a second or more to
   * start), then the two swap at once: the old loads stop with their
   * workers, and the tiles the map holds stay drawn as stale stand-ins
   * (`TileWorkingSetStore.insertStale`), each until its replacement lands.
   * The terrain stays: the style does not change it.
   */
  rebuildTiles(settings: ImmersiveMapSettings): void {
    this.currentSettings = settings;
    const previous = this.rebuilding ?? Promise.resolve();
    this.rebuilding = previous.then(async () => {
      if (this.destroyed) return;
      const workers = makeWorkerPipeline(this.settings, this.glyphs, this.workerCount);
      try {
        await workers.ready;
      } catch (error) {
        workers.destroy();
        console.error(`ImmersiveMap could not restart its tile workers: ${String(error)}`);
        return;
      }
      if (this.destroyed) {
        workers.destroy();
        return;
      }
      const kept = [...this.store.residentTiles().values()];
      this.loader.cancelAll();
      this.workers.destroy();
      // The labels let go of the tiles too: every one is made again.
      this.labelPrepare?.reset();
      this.labelInput = undefined;
      this.surfaceLabelFrame = undefined;
      this.parseTimes.clear();
      this.workers = workers;
      this.startTiles(workers);
      // The new store starts with the old tiles, stale: drawn where they were, asked for again.
      for (const resident of kept) this.store.insertStale(resident);
      this.loop.requestFrame("externalStateChanged");
    });
  }

  /**
   * @internal Settings the plan applies in place (`resolveSettingsRebuild`
   * said `live`), the Swift `RenderFrameEngine.applySettings` with the
   * host's runtimes: the camera and its animations, the render loop, the
   * control zones and the camera panel, the frame's pass plan (the
   * starfield behind a transparent space, FXAA), and the next frame reads
   * everything else off the settings.
   */
  applyLiveSettings(settings: ImmersiveMapSettings): void {
    if (this.destroyed) return;
    this.currentSettings = settings;
    const { cameraRuntime, cameraAnimationRuntime } = this.cameraRuntimes;
    cameraRuntime.updateSettings(settings);
    cameraAnimationRuntime.updateSettings();
    this.loop.applyConfiguration(settings.renderLoop);
    this.controlZones.applyControlZones(settings.camera.controlZones, settings.controls.isHidden);
    this.cameraControlPanel?.setEnabled(!settings.controls.isHidden);
    this.frameSetup.availability.starfieldEnabled = !settings.scene.space.isTransparent;
    this.engine.setTransparent(settings.scene.space.isTransparent);
    this.frameSetup.fxaa = planRenderFrameOutput(settings.postProcessing.fxaaEnabled, this.frameSetup.sampleCount).includesPostProcessingPass;
    this.relief?.applySettings(settings);
    this.loop.requestFrame("externalStateChanged");
  }

  /** @internal Where a renderer built in this one's place opens its camera (the Swift `cameraPositionForRendererRecreation`). */
  cameraPositionForRecreation(): ImmersiveMapCameraPosition | null {
    const runtime = this.cameraRuntimes.cameraRuntime;
    return runtime.cameraPositionForRendererRecreation() ?? runtime.currentCameraPosition();
  }

  /** The loader's observer while the debug panel shows: the tile status, and the tile trace while one records. */
  private debugLoaderObserver(hooks: ImmersiveMapDebugFrameHooks): TileLoaderStatusObserver {
    if (!hooks.tileTraceRecorder.isRecording) return hooks.tileLoadingStatus;
    if (this.tracingObserver?.recorder !== hooks.tileTraceRecorder) this.tracingObserver = { recorder: hooks.tileTraceRecorder, observer: new TileTraceLoaderObserver(hooks.tileTraceRecorder, hooks.tileLoadingStatus) };
    return this.tracingObserver.observer;
  }

  /** The label prepare's boxes and road label tiles for the debug report, the boxes turned to the projector's space (y up). */
  private debugLabelReport(drawHeight: number): Pick<DebugFrameReport, "labelBoxes" | "activeRoadLabelTiles"> {
    const prepare = this.labelPrepare;
    const controls = this.debugHooks?.controls.snapshot();
    if (prepare === undefined || controls === undefined) return {};
    const toBox = (box: LabelDebugBox): DebugLabelBox => ({
      center: [(box.minX + box.maxX) * 0.5, drawHeight - (box.minY + box.maxY) * 0.5],
      halfSize: [(box.maxX - box.minX) * 0.5, (box.maxY - box.minY) * 0.5],
      isVisible: box.isVisible,
    });
    const boxes = prepare.debugBoxes === undefined ? undefined : prepare.lastDebugBoxes;
    return {
      ...(boxes === undefined ? {} : { labelBoxes: { boxes: boxes.boxes.map(toBox), roadBoxes: boxes.roadBoxes.map(toBox) } }),
      ...(controls.roadLabelTilesEnabled ? { activeRoadLabelTiles: prepare.activeRoadLabelTiles } : {}),
    };
  }

  /** @internal The debug panel's surface switch: the camera's animations end, and the globe and the flat map trade places. */
  switchRenderModeForDebug(): void {
    this.cameraRuntimes.cameraAnimationRuntime.cancelAnimations();
    this.cameraRuntimes.cameraRuntime.switchRenderMode();
  }

  // MARK: Public API

  /** The settings the map runs by: the ones it was built with, the archive's depth resolved. */
  get settings(): ImmersiveMapSettings {
    return this.currentSettings;
  }

  /** Where the camera is now. */
  get view(): MapView {
    const position = this.cameraRuntimes.cameraRuntime.currentCameraPosition();
    return position === null ? { center: [0, 0], zoom: 0, bearing: 0, pitch: 0 } : viewFromCameraPosition(position);
  }

  /** Puts the camera there at once: what the view leaves out stays as it is. `camera.fly` animates instead. */
  set view(view: Partial<MapView>) {
    const runtime = this.cameraRuntimes.cameraRuntime;
    const current = runtime.currentCameraPosition();
    const position: ImmersiveMapCameraPosition = cameraPositionFromOption(view, current ?? undefined);
    runtime.setCameraPosition(position);
    // Setting the view is a jump: an app that sets it every frame drives the
    // camera, and the loop keeps the interaction rate for a grace period, as
    // `ImmersiveMapCameraController.jump` does (the Swift externalCameraDrive).
    runtime.noteExternalCameraDrive();
  }

  /** Every drawn frame. Returns the function that stops the listening. */
  onFrame(listener: (event: FrameEvent) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /** Every tile that lands on the GPU. Returns the function that stops the listening. */
  onTileLoaded(listener: (event: TileLoadedEvent) => void): () => void {
    this.tileListeners.add(listener);
    return () => this.tileListeners.delete(listener);
  }

  /**
   * The country around the point the camera looks at, mountains or a plain,
   * read off the relief's own heights, whenever it changes
   * (`ImmersiveMapTerrainSurroundings`): `null` while the map is off the
   * terrain. Returns the function that stops the listening.
   */
  onTerrainSurroundingsChange(listener: (surroundings: ImmersiveMapTerrainSurroundings | null) => void): () => void {
    this.surroundingsListeners.add(listener);
    return () => this.surroundingsListeners.delete(listener);
  }

  /** The reading of the last frame, `null` off the terrain. */
  get terrainSurroundings(): ImmersiveMapTerrainSurroundings | null {
    return this.lastSurroundings;
  }

  private publishTerrainSurroundings(surroundings: ImmersiveMapTerrainSurroundings | null): void {
    if (terrainSurroundingsEqual(surroundings, this.lastSurroundings)) return;
    this.lastSurroundings = surroundings;
    for (const listener of this.surroundingsListeners) listener(surroundings);
  }

  /**
   * The selection controller the map reports to and takes commands from,
   * null for none: without one a tap selects nothing, and the tap events
   * (`onPinTap`, `onLayerTap`) still arrive.
   */
  get selection(): ImmersiveMapSelectionController | null {
    return this.selectionHandler.selectionController;
  }

  set selection(controller: ImmersiveMapSelectionController | null) {
    this.selectionHandler.syncController(controller);
  }

  /**
   * A tap on the map, in CSS pixels of the canvas: the selectable features
   * first (the Swift `ImmersiveMapTapHandler`), and when none takes it, the
   * camera's background tap. A tap on a control zone never reaches here.
   */
  /**
   * Every tap on a pin, also on one already selected, with or without a
   * selection controller. Returns the function that stops the listening.
   */
  onPinTap(listener: (event: ImmersiveMapPinTapEvent) => void): () => void {
    this.pinTapListeners.add(listener);
    return () => this.pinTapListeners.delete(listener);
  }

  /**
   * Every tap on a shape of a layer the map shows (`ImmersiveMapLayerTapEvent`),
   * also on one already selected, with or without a selection controller.
   * While one listens, the shapes of the drawn layers are kept for the taps.
   * Returns the function that stops the listening.
   */
  onLayerTap(listener: (event: ImmersiveMapLayerTapEvent) => void): () => void {
    return this.layerRuntime.onLayerTap(listener);
  }

  /** The app's 3D models at coordinates (`ImmersiveMapSceneModelsController`): `map.sceneModels.set([...])`. */
  get sceneModels(): ImmersiveMapSceneModelsController {
    return this.models.controller;
  }

  /**
   * Every tap on a scene model (`ImmersiveMapSceneModelTapEvent`), also on
   * one already selected, with or without a selection controller. Returns
   * the function that stops the listening.
   */
  onSceneModelTap(listener: (event: ImmersiveMapSceneModelTapEvent) => void): () => void {
    this.sceneModelTapListeners.add(listener);
    return () => this.sceneModelTapListeners.delete(listener);
  }

  private handleMapTap(point: ImmersiveMapScreenPoint): void {
    if (this.selectionHandler.handleMapTap(point) === "background") this.cameraRuntimes.cameraRuntime.notifyMapBackgroundTap();
  }

  /** A double tap or a secondary tap a feature has claimed (the tile grid, by its settings). */
  private handleClaimedTap(kind: "double" | "secondary", point: ImmersiveMapScreenPoint): void {
    this.selectionHandler.handleMapTap(point, kind);
  }

  /**
   * The app's handle on the tile grid, null for none: attaching one shows
   * the grid, and null takes it away (`ImmersiveMapTileGridController`).
   */
  get tileGrid(): ImmersiveMapTileGridController | null {
    return this.tileGridRuntime.tileGridController;
  }

  set tileGrid(controller: ImmersiveMapTileGridController | null) {
    if (this.offscreen === undefined) this.tileGridRuntime.attach(controller);
  }

  /**
   * The recorder whose tour exports draw this map (the Swift
   * `tourVideoRecorder(_:)` modifier): the export takes the map's settings,
   * camera, pins, layers and annotations as they are when it starts, and
   * renders offscreen while this map stays interactive. Null detaches it.
   */
  get tourVideoRecorder(): ImmersiveMapTourVideoRecorder | null {
    return this.attachedTourVideoRecorder;
  }

  set tourVideoRecorder(recorder: ImmersiveMapTourVideoRecorder | null) {
    if (recorder === this.attachedTourVideoRecorder) return;
    this.attachedTourVideoRecorder?.detachRuntime(this);
    this.attachedTourVideoRecorder = recorder;
    recorder?.attachRuntime(this, {
      currentSettings: () => this.settings,
      currentCameraPosition: () => this.cameraRuntimes.cameraRuntime.currentCameraPosition(),
      currentPinsController: () => this.pins,
      currentLayersController: () => this.layers,
      currentAnnotationContent: () => this.annotations.exportContent(),
    });
  }

  /**
   * A still of this map, a PNG unless `options.type` says otherwise (the
   * Swift `ImmersiveMapStillRecorder` handed this map's settings, camera,
   * pins and layers): rendered offscreen at the configuration's size and
   * scale once the scene settled, while this map stays as it is. The camera
   * is this map's unless `options.camera` names another.
   */
  captureStill(options: Omit<ImmersiveMapStillCaptureOptions, "settings" | "pins" | "layers" | "sceneModels"> & ImmersiveMapStillEncoding = {}): Promise<Blob> {
    const camera = options.camera ?? this.cameraRuntimes.cameraRuntime.currentCameraPosition() ?? undefined;
    return new ImmersiveMapStillRecorder().capture({
      ...options,
      settings: this.settings,
      pins: this.pins,
      layers: this.layers,
      sceneModels: this.models.controller.models(),
      ...(camera === undefined ? {} : { camera }),
    });
  }

  /**
   * @internal One frame of an export's map at `time` seconds of its scene
   * clock: what the frame left to settle, `undefined` when it could not draw
   * (the camera not ready). The frame is in the canvas until the task ends.
   */
  renderOffscreenFrame(time: number): OffscreenFrameReport | undefined {
    this.offscreenReport = undefined;
    if (this.destroyed || this.offscreen === undefined || !this.drawFrame(time)) return undefined;
    return this.offscreenReport;
  }

  /** @internal The camera an export drives (`TourVideoTimelineDriver`), with the presentation its constraints come from. */
  get exportCamera(): { readonly renderCamera: FrameCameraStateResolver | null; readonly presentationStateResolver: MapPresentationStateController; readonly runtime: ImmersiveMapCameraRuntime } {
    const runtime = this.cameraRuntimes.cameraRuntime;
    return { renderCamera: runtime.renderCamera, presentationStateResolver: runtime.presentationStateResolver, runtime };
  }

  /** Asks for one frame, for state the map cannot see change. */
  requestFrame(): void {
    if (!this.destroyed) this.loop.requestFrame("externalStateChanged");
  }

  /** Tears everything down: the loop, the listeners, the workers, the GPU resources and the canvas. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cameraControlPanel?.destroy();
    this.attachedTourVideoRecorder?.detachRuntime(this);
    this.loop.stop();
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.gestures.detach();
    this.controlZones.attach(null);
    this.cameraRuntimes.cameraAnimationRuntime.cancelAnimations();
    this.cameraRuntimes.cameraRuntime.detachController();
    this.frameListeners.clear();
    this.tileListeners.clear();
    this.surroundingsListeners.clear();
    this.selectionHandler.syncController(null);
    this.pins.clearChangeHandler(this);
    this.pinTapListeners.clear();
    this.pinsGpu.destroy();
    this.relief?.destroy();
    this.reliefCasters?.destroy();
    this.occlusionGpu?.destroy();
    this.reliefGpu.destroy();
    this.workingSet.evict();
    this.workers.destroy();
    for (const tile of this.gpuTiles.values()) tile.gpu.buffer.destroy();
    this.gpuTiles.clear();
    this.parseTimes.clear();
    this.tileState = { ...this.tileState, placements: [] };
    this.cameraBuffer.destroy();
    this.overviewFadeBuffer.destroy();
    this.groundFogBuffer.destroy();
    this.globeBuffer.destroy();
    this.shadows.destroy();
    this.buildings.destroy();
    this.standingFrame.destroy();
    this.trees.destroy();
    this.treeModels.destroy();
    this.rasterTiles.destroy();
    this.placementStencil.destroy();
    this.globeCaps.destroy();
    this.labelPrepare?.reset();
    this.labelGpu?.destroy();
    this.layerRuntime.destroy();
    this.tileGridRuntime.destroy();
    this.models.destroy();
    this.sceneModelTapListeners.clear();
    this.engine.destroy();
    // A canvas the map keeps is handed to the next renderer's device.
    if (!this.ownsCanvas) this.engine.unconfigure();
    this.gpu.device.destroy();
    if (this.ownsAnnotations) this.annotations.destroy();
    this.attributionBadge.destroy();
    if (this.ownsCanvas) this.canvas.remove();
  }

  // MARK: Frame

  /**
   * One frame, the Swift `RenderFrameEngine.renderFrame`: the camera
   * animations advance, the presentation resolves from the camera state, the
   * frame's camera from the presentation's transition, then the coverage,
   * the working set (the demand, the loads, the placements), the frame
   * uniforms, and the engine encodes and submits the passes.
   */
  private drawFrame(now: number): boolean {
    if (this.destroyed) return false;
    const cpuStart = performance.now();
    const { width, height } = this.canvas;
    // Nothing to draw into: the resize asks for the next frame.
    if (width === 0 || height === 0) return true;
    const { cameraRuntime, cameraAnimationRuntime } = this.cameraRuntimes;
    cameraAnimationRuntime.advanceAnimationsIfNeeded(now);
    const renderCamera = cameraRuntime.renderCamera;
    if (renderCamera === null) return false;
    // The presentation depends on the camera state alone, and the camera's
    // pose on the presentation's phase (the globe proximity), so the
    // presentation resolves first.
    const presentation = cameraRuntime.presentationStateResolver.resolve(renderCamera.currentCameraState());
    const transition = presentation.presentationState.transition;
    const cameraFrame = renderCamera.makeFrameState(width, height, transition);
    if (cameraFrame === null) return false;
    this.frameNumber += 1;
    const settings = this.settings;
    const deltaTime = this.lastFrameTime === undefined ? undefined : Math.max(0, now - this.lastFrameTime);
    this.lastFrameTime = now;
    const cameraJumped = renderCamera.cameraJumpCount !== this.lastCameraJumpCount;
    this.lastCameraJumpCount = renderCamera.cameraJumpCount;
    // The animated zoom: the camera's followed over a few frames, or snapped
    // to a camera set outright (the Swift `RenderFrameEngine.collectInput`).
    const animatedZoom = this.animatedZoom.advance(cameraFrame.mapCameraState.zoom, deltaTime ?? 0, settings.camera.animatedZoomHalfLife, cameraJumped);
    this.reliefGpu.beginFrame();
    // The debug panel's drags (`DebugOverlayControlState`): the ring rules,
    // the relief's shading, occlusion and shadows, the labels' opacity.
    // Without a panel they are the settings' own.
    const debugHooks = this.debugHooks;
    const debugControls = debugHooks?.controls.snapshot();
    const debugActive = debugHooks?.isActive ?? false;
    if (debugHooks !== undefined) this.loader.statusObserver = debugActive ? this.debugLoaderObserver(debugHooks) : undefined;

    // The ground relief before the coverage, in the Swift engine's order:
    // the welds, the rise at the planning zoom, the world scale, the light,
    // the occlusion and the shadows, then the heights the coverage reaches
    // over, as the last frame's datum left them.
    const relief = this.relief;
    const renderMapSize = presentation.flatRenderState.renderMapSize;
    const center = cameraFrame.mapCameraState.centerWorldMercator;
    if (relief !== undefined) {
      if (this.followedCamera !== renderCamera) {
        this.followedCamera = renderCamera;
        renderCamera.setTerrainFollow(
          relief.state.makeTerrainFollow(
            (zoom) => TileCoverageZoomPolicy.resolve(zoom, "flat", resolvedMaximumZoomLevel(settings.tiles.coverage)).baseZoom,
            settings.presentation.globeRadiusScale,
            () => renderCamera.currentCameraState().zoom,
          ),
        );
      }
      relief.startFrame({
        planningZoom: cameraFrame.planningZoom,
        centerWorldMercator: center,
        deltaTime,
        cameraJumped,
        renderMapSize,
        cameraEye: cameraFrame.cameraEye,
        lightDirection: settings.scene.light.direction,
        renderSurfaceMode: presentation.renderSurfaceMode,
        debug:
          debugHooks === undefined
            ? undefined
            : {
                hillshadeFade: debugHooks.controls.hillshadeFade(),
                hillshadeAmounts: debugHooks.controls.hillshadeAmounts(),
                occlusion: debugHooks.controls.terrainOcclusion(),
                occlusionDebugView: debugHooks.controls.terrainOcclusionDebugView(),
                castsShadows: debugHooks.controls.reliefCastsShadows(),
              },
      });
    }
    const reliefHeights = relief?.coverageHeights(presentation.renderSurfaceMode);
    const visibleContent = this.visibility.resolve({
      cameraFrameState: cameraFrame,
      resolvedPresentation: presentation,
      coverage: settings.tiles.coverage,
      reliefHeights,
      // The ring rules are the debug panel's: an edited rule re-runs the coverage like a camera change would.
      ...(debugControls === undefined ? {} : { ruleSets: debugControls.ringRuleSets }),
    });
    // The relief is drawn from under the point the camera looks at: the
    // terrain there is the frame's datum. Settled here, every feature of the
    // frame reads this one relief.
    const reliefFrame: GroundReliefFrame | undefined = relief?.settleFrame({
      renderSurfaceMode: presentation.renderSurfaceMode,
      tileZoomLevel: visibleContent.tileZoomLevel,
      flatRingBands: visibleContent.flatRingBands,
      centerWorldMercator: center,
      planningZoom: cameraFrame.planningZoom,
      deltaTime,
    });
    const placement: TilePlacementState<MapTile> = this.workingSet.update({
      visibleContent,
      renderSurfaceMode: presentation.renderSurfaceMode,
      transition,
      presentation: settings.presentation,
      reliefActive: reliefFrame?.isActive ?? false,
      frameIndex: this.frameNumber,
    });
    // The tiles the frame shows, for the debug panel's tile list.
    if (debugActive) this.debugHooks!.tileLoadingStatus.recordDisplayedTiles(placement.placeTilesContext.tilePlacements.map((placeTile) => placeTile.resident.tile));
    const globe = presentation.globeRenderState.globeUniform;
    this.tileState = {
      placements: placement.placeTilesContext.tilePlacements,
      renderSurfaceMode: presentation.renderSurfaceMode,
      flatRenderState: presentation.flatRenderState,
      globe,
      relief: reliefFrame,
    };
    this.standingState = {
      placements: placement.buildingPlaceTilesContext.tilePlacements,
      renderSurfaceMode: presentation.renderSurfaceMode,
      flatRenderState: presentation.flatRenderState,
      timeSeconds: now,
      projectionView: cameraFrame.cameraMatrices.projectionView,
      relief: reliefFrame,
    };

    const projectionView = cameraFrame.cameraMatrices.projectionView;
    const pixelsPerPoint = this.offscreen?.pixelsPerPoint ?? devicePixelRatio;
    writeGpuCameraUniform(this.cameraStaging, 0, projectionView, cameraFrame.cameraEye);
    // The point-locked road widths are stated at the ground under the centre
    // of the screen: on the relief the terrain there, else the plane.
    const reliefCentreDepth = relief?.centreGroundDepth(projectionView, center, visibleContent.tileZoomLevel, renderMapSize);
    writeOverviewFade(this.overviewFadeStaging, pixelsPerPoint, cameraFrame.planningZoom, width, height, projectionView, reliefCentreDepth);
    const { queue } = this.gpu.device;
    queue.writeBuffer(this.cameraBuffer, 0, this.cameraStaging);
    queue.writeBuffer(this.overviewFadeBuffer, 0, this.overviewFadeStaging);
    // Only the sphere's shaders read the globe uniform: a flat frame leaves it as it was.
    this.globeConstants = presentation.renderSurfaceMode !== "flat" ? this.writeGlobeUniform(presentation, projectionView) : undefined;
    this.pinFrame = { cameraUniform: { matrix: projectionView, eye: cameraFrame.cameraEye }, presentation, screenMatrix: cameraFrame.cameraMatrices.screen, timeSeconds: now };
    this.layerFrame = layerFrameOf(presentation, cameraFrame, reliefFrame?.isActive ?? false);
    this.tileGridFrame = tileGridFrameOf(presentation, cameraFrame);
    this.sceneModelFrame = { drawWidth: width, drawHeight: height, projectionView: cameraFrame.cameraMatrices.projectionView, cameraEye: cameraFrame.cameraEye, presentation, timeSeconds: now, frameIndex: this.frameNumber };
    this.modelTileFrame = {
      renderSurfaceMode: presentation.renderSurfaceMode,
      planningZoom: cameraFrame.planningZoom,
      visibleTiles: visibleContent.visibleTiles,
      flatRenderState: presentation.flatRenderState,
      projectionView: cameraFrame.cameraMatrices.projectionView,
      timeSeconds: now,
    };
    this.prepareLabelFrame(now, cameraFrame, presentation, placement.placeTilesContext.tilePlacements, visibleContent, pixelsPerPoint);

    const setup: FrameSetup = {
      ...this.frameSetup,
      availability: { ...this.frameSetup.availability, renderSurfaceMode: presentation.renderSurfaceMode },
      clearColor: frameClearColor(transition, settings.presentation, settings.scene.space, themeBaseColors(settings.data.mapStyle.theme).map),
      // The road names hide behind the buildings from their zoom on, on the
      // flat map: the overlay tests them against the world's depth.
      keepsSceneDepth: this.labelGpu !== undefined && presentation.renderSurfaceMode === "flat" && cameraFrame.planningZoom >= settings.data.labels.road.hidesBehindBuildingsFromZoom,
    };
    this.sceneState = {
      settings,
      cameraFrame,
      presentation,
      mapColor: themeBaseColors(settings.data.mapStyle.theme).map,
      timeSeconds: now,
      groundRelief: reliefFrame === undefined ? undefined : { isActive: reliefFrame.isActive, datumMetres: reliefFrame.datumMetres },
      mountainousness: relief?.terrainSurroundings?.mountainousness ?? 0,
      animatedZoom,
    };
    GroundFogUniform.write(this.groundFogStaging, 0, GroundFogUniform.resolveFrame(this.sceneState));
    queue.writeBuffer(this.groundFogBuffer, 0, this.groundFogStaging);
    GroundFogUniform.write(this.buildingFogStaging, 0, GroundFogUniform.resolveFrame(this.sceneState, true));
    queue.writeBuffer(this.standingFrame.buildingFogBuffer, 0, this.buildingFogStaging);

    // The light's windows before the subsystems update, the gate after
    // them (the buildings say what casts), as the Swift engine resolves them.
    this.shadows.resolveFrame({
      renderSurfaceMode: presentation.renderSurfaceMode,
      projectionView,
      cameraEye: cameraFrame.cameraEye,
      centerWorldMercator: cameraFrame.mapCameraState.centerWorldMercator,
      flatRenderPan: presentation.flatRenderState.pan,
      renderMapSize: presentation.flatRenderState.renderMapSize,
      // The relief's heights as the coverage reads them: the window reaches
      // the valleys and the summits.
      groundHeights: reliefHeights === undefined ? undefined : [reliefHeights.lowerBound, reliefHeights.upperBound],
      // The strength and the coverages read the zoom the eye sees, so a zoom gesture plays them.
      zoom: animatedZoom,
      scene: settings.scene,
    });
    this.shadows.prepareTextures(width, height);
    setup.planShadowPasses = () =>
      this.shadows.plan({
        buildingPlacements: this.buildings.drawnPlacements,
        buildingRiseSignature: this.buildings.shadowRiseSignature,
        modelCasters: this.models.state.staticShadowCasters,
        hasMovingModelCasters: this.models.state.hasMovingShadowCasters,
        terrain: reliefFrame?.shadowSignature,
        projectionView,
        drawWidth: width,
        drawHeight: height,
      });
    const frameBindGroup = this.tileFrameBindGroup();
    this.engine.frame(setup, width, height, (frameNumber) => ({
      frameNumber,
      drawWidth: width,
      drawHeight: height,
      pixelsPerPoint,
      planningZoom: cameraFrame.planningZoom,
      frameBindGroup,
      drawParameters: this.engine.drawParameters,
      sceneDepth: this.engine.sceneDepth,
    }));
    this.destroyReleasedTiles();
    // What the features drew is what a tap is tested against.
    if (this.pickDataProviders.length > 0) {
      const pickData: SelectionPickData[] = [];
      for (const provider of this.pickDataProviders) {
        const data = provider();
        if (data !== null) pickData.push(data);
      }
      this.selectionHandler.updatePickData(pickData);
    }
    // The buildings and the trees rising out of the ground keep the frames coming.
    this.loop.setRenderingActivity("extrusionRise", this.buildings.isRising || this.trees.isRising);
    // The label fades run the loop at their own cadence until they settle.
    if (this.labelPrepare !== undefined) this.loop.setRenderingActivity("labelFade", this.labelPrepare.hasActiveFadeAnimations);
    // A pin that moves, breathes, fades, is pushed or waits for its picture keeps the frames coming.
    this.loop.setRenderingActivity("pinAnimation", this.pinsRenderer.hasActiveAnimations);
    // The flights that ended reach the app's controller, and a model moving, a model tile rising or being written keeps the frames coming.
    this.models.frameDrawn();
    this.loop.setRenderingActivity("sceneModelAnimation", this.models.isAnimating);
    // The animated zoom settling on the camera's, and the relief rising out
    // of the plane or collapsing into it, keep the frames coming.
    this.loop.setRenderingActivity("animatedZoom", this.animatedZoom.isSettling || (relief?.state.isTransitioning ?? false));
    this.publishTerrainSurroundings(relief?.terrainSurroundings ?? null);
    // The page's overlays follow what this frame drew: the badge's credits
    // at the camera's zoom, the annotations at the frame's projection.
    this.attributionBadge.sync(settings, presentation.semanticWorldState.cameraState.zoom);
    this.annotations.frameDrawn(width, height, { matrix: projectionView, eye: cameraFrame.cameraEye }, presentation, this.frameNumber);
    if (this.offscreen !== undefined) {
      // What an export waits for before it takes the frame (the Swift export's counters and activity state).
      this.offscreenReport = {
        drawn: true,
        requestedTiles: placement.requestedTilesCount,
        pendingTerrainTiles: relief?.state.pendingTerrainTileCount ?? 0,
        pendingLayerMeshes: this.layerRuntime.subsystem.pendingCount,
        pendingSceneModelMeshes: this.models.pendingCount,
        labelFadeActive: this.labelPrepare?.hasActiveFadeAnimations ?? false,
        pinAnimationActive: this.pinsRenderer.hasActiveAnimations,
        extrusionRiseActive: this.buildings.isRising || this.trees.isRising,
        animatedZoomActive: this.animatedZoom.isSettling || (relief?.state.isTransitioning ?? false),
        projection: new GeoScreenProjectionFrameConstants(width, height, { matrix: new Float64Array(projectionView), eye: [...cameraFrame.cameraEye] }, presentation),
      };
    }

    // The debug panel reads the frame it is in step with, one to one.
    if (debugActive) {
      this.debugHooks!.frameDrawn({
        frameIndex: this.frameNumber,
        drawWidth: width,
        drawHeight: height,
        pixelsPerPoint,
        mapCameraState: cameraFrame.mapCameraState,
        planningZoom: cameraFrame.planningZoom,
        animatedZoom,
        cameraEye: cameraFrame.cameraEye,
        projectionView,
        renderSurfaceMode: presentation.renderSurfaceMode,
        transition,
        flatRenderState: presentation.flatRenderState,
        projection: new GeoScreenProjectionFrameConstants(width, height, { matrix: projectionView, eye: cameraFrame.cameraEye }, presentation),
        tileZoomLevel: visibleContent.tileZoomLevel,
        flatRingBands: visibleContent.flatRingBands,
        placements: placement.placeTilesContext.tilePlacements,
        reliefFrame,
        terrainSurroundings: relief?.terrainSurroundings ?? undefined,
        terrainFollowReport: renderCamera.lastTerrainFollowReport ?? undefined,
        timings: { frameDeltaSeconds: deltaTime, cpuMilliseconds: performance.now() - cpuStart, gpuMilliseconds: this.engine.gpuMilliseconds, drawCount: this.engine.drawParameters.recordCount },
        tiles: { visible: placement.visibleTilesCount, ready: placement.readyTilesCount, requested: placement.requestedTilesCount, rendered: placement.renderedTilesCount },
        pending: { terrainTiles: relief?.state.pendingTerrainTileCount ?? 0, layerMeshes: this.layerRuntime.subsystem.pendingCount, sceneModelMeshes: this.models.pendingCount },
        ...this.debugLabelReport(height),
      });
    }

    if (this.frameListeners.size > 0) {
      const event = makeFrameEvent({
        frameNumber: this.frameNumber,
        cpuStart,
        cpuEnd: performance.now(),
        gpuMilliseconds: this.engine.gpuMilliseconds,
        draws: this.engine.drawParameters.recordCount,
        placement,
        transition,
        pendingTerrainTiles: relief?.state.pendingTerrainTileCount ?? 0,
        pendingLayerMeshes: this.layerRuntime.subsystem.pendingCount,
        pendingSceneModelMeshes: this.models.pendingCount,
        drawnAppLayers: this.layerRuntime.subsystem.drawnLayerCount,
        drawnTileGridTiles: this.tileGridRuntime.subsystem.drawnTileCount,
      });
      for (const listener of this.frameListeners) listener(event);
    }
    return true;
  }

  /**
   * The tile pipelines' frame group: the camera, the overview fade, the
   * ground fog, the globe, and the ground's shadows (the frame's shadow
   * uniform and the ground shadow mask), built again when a shadow texture
   * was made again.
   */
  private tileFrameBindGroup(): GPUBindGroup {
    const resources = this.shadows.resources;
    const generation = resources.generation;
    if (this.frameBindGroupState?.generation !== generation) {
      this.frameBindGroupState = {
        generation,
        group: this.gpu.device.createBindGroup({
          label: "tile frame",
          layout: this.pipelines.frameLayout,
          entries: [
            { binding: 0, resource: { buffer: this.cameraBuffer } },
            { binding: 1, resource: { buffer: this.overviewFadeBuffer } },
            { binding: 2, resource: { buffer: this.groundFogBuffer } },
            { binding: 3, resource: { buffer: this.globeBuffer } },
            { binding: 4, resource: { buffer: resources.shadowUniformBuffer } },
            { binding: 5, resource: resources.groundShadowMaskView },
            { binding: 6, resource: resources.maskSampler },
            // The shadow map's windows, which the relief samples at its raised points.
            { binding: 7, resource: resources.shadowMapView },
            { binding: 8, resource: resources.comparisonSampler },
          ],
        }),
      };
    }
    return this.frameBindGroupState.group;
  }

  /**
   * The globe's frame uniform: the composed sphere matrices under the
   * camera matrix the GPU draws with, the sun (its strength at the camera's
   * own zoom, faded out as the unroll starts, by the semantic transition),
   * and the handover of the globe's look to the plane's (the air's curve
   * at the geometry's transition, as the Swift globe drawer reads it).
   */
  private writeGlobeUniform(presentation: ResolvedPresentationState, projectionView: Mat4): GlobeFrameConstants {
    const settings = this.settings;
    const globe = presentation.globeRenderState.globeUniform;
    mat4Multiply(this.gpuCameraMatrix, RenderCamera.gpuClipDepthAdjustment, projectionView);
    const light = GlobeLight.resolve(
      settings.scene.globeLight,
      GlobeSunDirection.sunWorldDirection(settings.scene.globeLight, globe),
      presentation.renderSurfaceMode,
      presentation.presentationState.transition,
      presentation.semanticWorldState.cameraState.zoom,
    );
    const constants = GlobeFrameConstants.make(globe, this.gpuCameraMatrix);
    writeGlobeFrameUniform(this.globeStaging, {
      globe,
      constants,
      light,
      handover: airHandover(settings.presentation, globe.transition),
    });
    this.gpu.device.queue.writeBuffer(this.globeBuffer, 0, this.globeStaging);
    return constants;
  }

  /**
   * What the label subsystems read of this frame: the placements, the
   * camera, the surface and the globe, the time the fades advance by, the
   * colours' handover to the plane (the semantic transition's air, as the
   * Swift `FrameContext.groundHandover`) and the label opacity at the
   * planning zoom. The buildings' rise is added when the labels update,
   * after the buildings (`labelInput` in the constructor).
   */
  private prepareLabelFrame(
    now: number,
    cameraFrame: CameraFrameState,
    presentation: ResolvedPresentationState,
    placements: readonly PlaceTile<MapTile>[],
    visibleContent: VisibleContentState,
    pixelsPerPoint: number,
  ): void {
    if (this.labelPrepare === undefined) return;
    const settings = this.settings;
    const spherical = presentation.renderSurfaceMode === "spherical";
    const handover = spherical ? airHandover(settings.presentation, presentation.presentationState.transition) : 1;
    // The style's curves, or the debug panel's over them.
    const labelOpacity = labelOpacityFrame(this.debugHooks?.controls.labelOpacity() ?? settings.data.mapStyle.theme.labelOpacity, cameraFrame.planningZoom);
    const globe = presentation.globeRenderState.globeUniform;
    const constants = this.globeConstants;
    // The debug panel's reach over the settings', its boxes and its trace.
    const debugHooks = this.debugHooks;
    let debugReach: LabelFrameInput["debugReach"];
    if (debugHooks !== undefined) {
      const controls = debugHooks.controls.snapshot();
      debugReach = {
        distanceRules: controls.labelDistanceRules,
        localDetailMaximumDistanceMeters: controls.localLabelMaximumDistanceMeters,
        perspectiveMinimumScale: controls.labelPerspectiveMinimumScale,
      };
      const wantsBoxes = debugHooks.isActive && (controls.baseLabelBoundsEnabled || controls.roadLabelBoundsEnabled);
      this.labelPrepare.debugBoxes = wantsBoxes ? { base: controls.baseLabelBoundsEnabled, road: controls.roadLabelBoundsEnabled } : undefined;
      this.labelPrepare.traceRecorder = debugHooks.baseLabelTraceRecorder;
    }
    this.labelInput = {
      frameIndex: this.frameNumber,
      debugReach,
      placements,
      renderSurfaceMode: presentation.renderSurfaceMode,
      screenSpaceProjectionMode: presentation.screenSpaceProjectionMode,
      projectionView: cameraFrame.cameraMatrices.projectionView,
      cameraEye: cameraFrame.cameraEye,
      cameraState: cameraFrame.mapCameraState,
      drawWidth: cameraFrame.drawWidth,
      drawHeight: cameraFrame.drawHeight,
      planningZoom: cameraFrame.planningZoom,
      pixelsPerPoint,
      // The render loop's clock is in seconds.
      timeSeconds: now,
      flatRenderState: presentation.flatRenderState,
      globe,
      globeConstants: constants === undefined ? undefined : { sphereWorld: constants.sphereWorld, mapSize: constants.mapSize, panMercatorY: constants.panMercatorY },
      centerWorldMercator: visibleContent.centerWorldMercator,
      tileZoomLevel: visibleContent.tileZoomLevel,
      relief: this.tileState.relief,
    };
    this.labelDraw = {
      screenMatrix: cameraFrame.cameraMatrices.screen,
      handover,
      labelOpacity,
      roadScene: { projectionView: cameraFrame.cameraMatrices.projectionView, eye: [cameraFrame.cameraEye[0], cameraFrame.cameraEye[1], cameraFrame.cameraEye[2]], viewport: [this.canvas.width, this.canvas.height] },
    };
    const normalization = presentation.renderNormalizationState;
    this.surfaceLabelFrame = {
      placements,
      renderSurfaceMode: presentation.renderSurfaceMode,
      flatRenderState: presentation.flatRenderState,
      globe,
      tileWorldSize: normalization.flatRenderMapSize / normalization.zoomScale,
      handover,
      labelOpacity,
      atlasEmTexels: this.atlasEmTexels,
    };
  }

  // MARK: Tiles

  /** A prepared tile into GPU state and into the store, on the main thread (the loader's materialize stage). */
  private materialize(tile: Tile, prepared: PreparedTilePayload): "materialized" | "imageUnreadable" | "allocationOrStoreFailed" {
    if (this.destroyed) return "allocationOrStoreFailed";
    const key = tileKey(tile);
    const parseMilliseconds = this.parseTimes.get(key);
    this.parseTimes.delete(key);
    const resident = makeMapTile(this.gpu.device, this.pipelines.stylesLayout, tile, prepared.arena, prepared.meta);
    if (resident === undefined) return "imageUnreadable";
    this.store.insert(resident);
    const replaced = this.gpuTiles.get(key);
    this.gpuTiles.set(key, resident);
    // The tile it replaces may have been drawn by the last frame: WebGPU keeps it alive until that work completes.
    replaced?.gpu.buffer.destroy();
    this.loop.requestFrame("tileAvailable");
    if (this.tileListeners.size > 0) {
      const event: TileLoadedEvent = { tile, gpuBytes: resident.gpu.byteLength, parseMilliseconds };
      for (const listener of this.tileListeners) listener(event);
    }
    return "materialized";
  }

  /**
   * Destroys the buffers of the tiles the store let go of. After the frame's
   * submit: a tile released by this frame's demand was drawn by the last
   * one at most, and a destroyed buffer lives on until the GPU work that
   * reads it completes.
   */
  private destroyReleasedTiles(): void {
    if (!this.storeReleased) return;
    this.storeReleased = false;
    const residents = this.store.residentTiles();
    for (const [key, tile] of this.gpuTiles) {
      if (residents.get(key) === tile) continue;
      tile.gpu.buffer.destroy();
      this.gpuTiles.delete(key);
    }
  }
}

/**
 * The drawable's size in device pixels. The device-pixel content box is exact
 * where the browser reports it, but an emulated device scale (headless
 * Chrome's `deviceScaleFactor`) reports it in CSS pixels: a box that differs
 * from the CSS size times the ratio by more than rounding is not trusted.
 */
export function drawableSize(entry: Pick<ResizeObserverEntry, "contentRect" | "devicePixelContentBoxSize">, ratio: number): [number, number] {
  const width = Math.max(1, Math.round(entry.contentRect.width * ratio));
  const height = Math.max(1, Math.round(entry.contentRect.height * ratio));
  const box = entry.devicePixelContentBoxSize?.[0];
  if (box && Math.abs(box.inlineSize - width) <= 2 && Math.abs(box.blockSize - height) <= 2) return [Math.max(1, box.inlineSize), Math.max(1, box.blockSize)];
  return [width, height];
}

/**
 * Watches the canvas's size, by its device-pixel content box where the
 * browser has it. WebKit does not know that box and throws on it: there the
 * content box is watched, and `drawableSize` takes its CSS size times the
 * device pixel ratio.
 */
export function observeDrawableSize(observer: Pick<ResizeObserver, "observe">, canvas: Element): void {
  try {
    observer.observe(canvas, { box: "device-pixel-content-box" });
  } catch {
    observer.observe(canvas, { box: "content-box" });
  }
}

/** The tile pipelines' context of a device. */
function pipelineContextOf(gpu: GpuContext, sampleCount: number): { device: GPUDevice; colorFormat: GPUTextureFormat; depthStencilFormat: GPUTextureFormat; sampleCount: number } {
  return { device: gpu.device, colorFormat: gpu.colorFormat, depthStencilFormat: gpu.depthStencilFormat, sampleCount };
}

/** The key an archive's depth is kept under: the archive's absolute URL. */
function archiveRevisionOf(settings: ImmersiveMapSettings): string {
  return new URL(settings.tiles.network.tileArchiveURL, location.href).href;
}

/** The tile workers for the settings: the archive, the overview, the disk cache and the parser's configuration. */
function makeWorkerPipeline(settings: ImmersiveMapSettings, glyphs: readonly number[], count: number): WorkerTilePipeline {
  // Absolute, since a worker resolves a relative URL against its own script.
  const archiveURL = archiveRevisionOf(settings);
  const parse = tileParserConfig(settings, glyphs);
  const cache = settings.tiles.cache;
  return new WorkerTilePipeline(
    {
      archive: archiveURL,
      requestHeaders: { ...settings.tiles.network.tileRequestHeaders },
      overviewEnabled: settings.tiles.overview.isEnabled,
      overviewURL: bundledOverviewURL,
      cache: cache.preparedTileCacheEnabled
        ? {
            namespace: preparedTileCacheNamespace(settings, archiveURL, parse),
            byteQuota: cache.preparedDiskCacheSizeInBytes,
            timeToLive: cache.preparedDiskTimeToLive,
            sourceRevision: archiveURL,
          }
        : undefined,
      parse,
    },
    count,
  );
}
