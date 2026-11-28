// Copyright (c) 2025-2026 Artem Bobkin.
// SPDX-License-Identifier: MIT

/**
 * The map: a canvas in the app's container and everything that draws on it,
 * the Swift `ImmersiveMap` view with its host runtime
 * (`ImmersiveMapHostRuntime`). The map holds what the app gave it (the
 * controllers, the listeners, the annotations, the debug panel) and the
 * renderer that draws (`ImmersiveMapRenderer`): new settings go through the
 * planner (`planSettingsApplication`) and are applied to the renderer in
 * place, or the renderer's tiles or the renderer itself are built again, as
 * the Swift host decides.
 *
 * ```ts
 * const map = await ImmersiveMap.create({ container, camera: { city: "paris", zoom: 15 } });
 * map.camera.fly(ImmersiveMapCameraPosition.make(48.8584, 2.2945, 16));
 * map.setSettings((settings) => settings.night());
 * map.onFrame((frame) => console.log(frame.cpuMilliseconds));
 * ```
 *
 * Rendering is on demand: a frame is drawn when the camera moves, a tile
 * lands, an animation runs or the app asks for one.
 */

import type { ImmersiveMapCameraPosition } from "../camera/immersive-map-camera-position.ts";
import { ImmersiveMapSettings } from "../configuration/immersive-map-settings.ts";
import { planSettingsApplication } from "../configuration/settings-application-planner.ts";
import { ImmersiveMapAnnotations } from "../annotations/immersive-map-annotations.ts";
import type { ImmersiveMapTourVideoRecorder } from "../export/immersive-map-tour-video-recorder.ts";
import type { ImmersiveMapStillCaptureOptions, ImmersiveMapStillEncoding } from "../export/immersive-map-still-recorder.ts";
import type { ImmersiveMapLayerTapEvent } from "../layers/immersive-map-layer-tap-event.ts";
import { ImmersiveMapLayersController } from "../layers/immersive-map-layers-controller.ts";
import { ImmersiveMapPinsController } from "../pins/immersive-map-pins-controller.ts";
import type { ImmersiveMapPinTapEvent } from "../pins/selection/pin-selection.ts";
import { ImmersiveMapSceneModelsController } from "../scene-models/immersive-map-scene-models-controller.ts";
import type { ImmersiveMapSceneModelTapEvent } from "../scene-models/immersive-map-scene-model-tap-event.ts";
import type { ImmersiveMapSelectionController } from "../selection/immersive-map-selection.ts";
import type { ImmersiveMapTileGridController } from "../tile-grid/immersive-map-tile-grid-controller.ts";
import { TileArchiveDepths } from "../tile/loading/archive-depths.ts";
import type { ImmersiveMapTerrainSurroundings } from "../tile/relief/lifts/terrain-surroundings.ts";
import { ImmersiveMapCameraController } from "./camera/immersive-map-camera-controller.ts";
import { ImmersiveMapDebugRuntimeSlot, type ImmersiveMapDebugPanel } from "./immersive-map-debug-panel.ts";
import { ImmersiveMapRenderer, type ImmersiveMapOptions as ImmersiveMapRendererAppOptions, type TileLoadedEvent } from "./immersive-map.ts";
import { resolveSettingsRebuild } from "./immersive-map-settings-rebuild.ts";
import { LoadingIndicator } from "./loading-indicator.ts";
import { DeviceRecovery, type ImmersiveMapDeviceLostEvent } from "./device-recovery.ts";
import type { FrameEvent, MapView } from "./immersive-map-view.ts";

export interface ImmersiveMapOptions extends ImmersiveMapRendererAppOptions {
  /**
   * The debug panel drawn over the map (`ImmersiveMapDebugPanel.hud` of
   * `@artembobkin/immersive-map/debug`, the Swift `debugPanel(_:)` modifier): its
   * HUD, its overlays and the settings it drags live. Giving one switches
   * the panel on in the settings (`ImmersiveMapSettings.debugPanel`), and
   * `debugPanel(false)` hides it from then on. None when left out.
   */
  readonly debugPanel?: ImmersiveMapDebugPanel;
  /** The panel's zoom badge, as `ImmersiveMapSettings.debugPanel(_, { zoomBadge })` says, the settings' when left out. */
  readonly debugZoomBadge?: boolean;
}

/** A listener the map keeps and hands every renderer it builds. */
interface ForwardedListeners<Listener> {
  readonly listeners: Map<Listener, () => void>;
  readonly subscribe: (renderer: ImmersiveMapRenderer, listener: Listener) => () => void;
}

function forwarded<Listener>(subscribe: (renderer: ImmersiveMapRenderer, listener: Listener) => () => void): ForwardedListeners<Listener> {
  return { listeners: new Map(), subscribe };
}

export class ImmersiveMap {
  /** The camera's commands (jump, fly, follow) and callbacks. */
  readonly camera: ImmersiveMapCameraController;
  /** The app's pins (`ImmersiveMapPinsController`): `map.pins.set([...])`. */
  readonly pins: ImmersiveMapPinsController;
  /** The app's own data drawn over the map (`ImmersiveMapLayersController`): `map.layers.register(...)`. */
  readonly layers: ImmersiveMapLayersController;
  /** The DOM elements the app stands on coordinates (`annotations.set`, `annotations.clear`). */
  readonly annotations: ImmersiveMapAnnotations;
  /** The canvas the map draws into, kept across every renderer. */
  readonly canvas: HTMLCanvasElement;

  private renderer: ImmersiveMapRenderer | null;
  private readonly options: ImmersiveMapOptions;
  private readonly sceneModelsController: ImmersiveMapSceneModelsController;
  private selectionController: ImmersiveMapSelectionController | null;
  private tileGridController: ImmersiveMapTileGridController | null;
  private attachedTourVideoRecorder: ImmersiveMapTourVideoRecorder | null = null;
  /** The settings the map runs by, the debug panel's drags on top and the archive's depth resolved (the Swift `cameraRuntime.currentSettings`). */
  private currentSettings: ImmersiveMapSettings;
  /** A renderer being built in place of the last, and whether settings changed while it was. */
  private recreation: Promise<void> | null = null;
  private destroyed = false;
  private readonly archiveDepths = new TileArchiveDepths();
  private readonly debug: ImmersiveMapDebugRuntimeSlot;
  /** How often a renderer is built again after a lost GPU device. */
  private readonly deviceRecovery = new DeviceRecovery();
  private readonly deviceLostListeners = new Set<(event: ImmersiveMapDeviceLostEvent) => void>();
  private readonly deviceRestoredListeners = new Set<() => void>();
  /** The sign that the map has no renderer that drew a frame yet, none when the app shows its own. */
  private readonly loadingIndicator: LoadingIndicator | null;

  private readonly frameEvents = forwarded<(event: FrameEvent) => void>((renderer, listener) => renderer.onFrame(listener));
  private readonly tileEvents = forwarded<(event: TileLoadedEvent) => void>((renderer, listener) => renderer.onTileLoaded(listener));
  private readonly surroundingsEvents = forwarded<(surroundings: ImmersiveMapTerrainSurroundings | null) => void>((renderer, listener) =>
    renderer.onTerrainSurroundingsChange(listener),
  );
  private readonly pinTapEvents = forwarded<(event: ImmersiveMapPinTapEvent) => void>((renderer, listener) => renderer.onPinTap(listener));
  private readonly layerTapEvents = forwarded<(event: ImmersiveMapLayerTapEvent) => void>((renderer, listener) => renderer.onLayerTap(listener));
  private readonly sceneModelTapEvents = forwarded<(event: ImmersiveMapSceneModelTapEvent) => void>((renderer, listener) => renderer.onSceneModelTap(listener));

  /** Builds the map in `options.container`: resolves once the GPU and the tile workers are ready. */
  static async create(options: ImmersiveMapOptions): Promise<ImmersiveMap> {
    let settings = options.settings ?? ImmersiveMapSettings.default;
    if (options.url !== undefined) settings = settings.tileArchive(options.url, settings.tiles.network.tileRequestHeaders);
    // Giving a panel switches it on, as the Swift `debugPanel(_:)` modifier does.
    if (options.debugPanel !== undefined) settings = settings.debugPanel(true, { zoomBadge: options.debugZoomBadge });
    const map = new ImmersiveMap({ ...options, settings });
    try {
      await map.buildRenderer(settings, options.camera === undefined ? null : undefined, false);
    } catch (error) {
      map.destroy();
      throw error;
    }
    return map;
  }

  private constructor(options: ImmersiveMapOptions & { readonly settings: ImmersiveMapSettings }) {
    this.options = options;
    this.currentSettings = options.settings;
    this.camera = options.cameraController ?? new ImmersiveMapCameraController();
    this.pins = options.pins ?? new ImmersiveMapPinsController();
    this.layers = options.layers ?? new ImmersiveMapLayersController();
    this.sceneModelsController = options.sceneModels ?? new ImmersiveMapSceneModelsController();
    this.selectionController = options.selection ?? null;
    this.tileGridController = options.tileGrid ?? null;
    this.renderer = null;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%;cursor:grab";
    options.container.append(canvas);
    this.canvas = canvas;
    this.loadingIndicator = options.loadingIndicator === false ? null : new LoadingIndicator(canvas);
    if (getComputedStyle(options.container).position === "static") options.container.style.position = "relative";
    this.annotations = new ImmersiveMapAnnotations(canvas, () => this.requestFrame());
    this.debug = new ImmersiveMapDebugRuntimeSlot({
      container: options.container,
      canvas,
      requestFrame: () => this.requestFrame(),
      switchRenderMode: () => this.renderer?.switchRenderModeForDebug(),
      applySettings: (settings) => this.applySettings(settings),
    });
    if (options.debugPanel !== undefined) this.debug.install(options.debugPanel, this.currentSettings);
    if (options.tourVideoRecorder) this.tourVideoRecorder = options.tourVideoRecorder;
  }

  /**
   * A renderer for the settings, opened at `cameraPosition` (`undefined`
   * for the options' camera, `null` for the renderer's own start), the
   * listeners and the controllers handed over to it.
   */
  private async buildRenderer(settings: ImmersiveMapSettings, cameraPosition: ImmersiveMapCameraPosition | null | undefined, isRecreation: boolean): Promise<void> {
    const { camera: _camera, ...appOptions } = this.options;
    // The renderer a loss is of, known once it is built (a loss before that is a failed build).
    let built: ImmersiveMapRenderer | null = null;
    this.loadingIndicator?.show();
    const renderer = await ImmersiveMapRenderer.create({
      ...appOptions,
      ...(cameraPosition === undefined ? (this.options.camera === undefined ? {} : { camera: this.options.camera }) : cameraPosition === null ? {} : { camera: cameraPosition }),
      settings,
      cameraController: this.camera,
      pins: this.pins,
      layers: this.layers,
      sceneModels: this.sceneModelsController,
      selection: this.selectionController,
      tileGrid: this.tileGridController,
      tourVideoRecorder: null,
      canvas: this.canvas,
      annotationsController: this.annotations,
      isRecreation,
      onArchiveDepthChange: (next) => this.applySettings(next),
      debugHooks: this.debug.frameHooks,
      onDeviceLost: (info) => {
        if (built !== null) this.deviceLost(built, info);
      },
    });
    if (this.destroyed) {
      renderer.destroy();
      return;
    }
    built = renderer;
    this.renderer = renderer;
    // The sign of the start goes with the renderer's first frame.
    const stopListening = renderer.onFrame(() => {
      stopListening();
      if (this.renderer === renderer) this.loadingIndicator?.hide();
    });
    // The renderer resolved the archive's depth as last read: the map runs by it.
    if (!isRecreation) this.currentSettings = renderer.settings;
    for (const events of this.allEvents()) {
      for (const listener of events.listeners.keys()) events.listeners.set(listener, events.subscribe(renderer, listener as never));
    }
  }

  private allEvents(): ForwardedListeners<unknown>[] {
    return [this.frameEvents, this.tileEvents, this.surroundingsEvents, this.pinTapEvents, this.layerTapEvents, this.sceneModelTapEvents] as ForwardedListeners<unknown>[];
  }

  private listen<Listener>(events: ForwardedListeners<Listener>, listener: Listener): () => void {
    if (!events.listeners.has(listener)) events.listeners.set(listener, this.renderer === null ? () => undefined : events.subscribe(this.renderer, listener));
    return () => {
      events.listeners.get(listener)?.();
      events.listeners.delete(listener);
    };
  }

  // MARK: Settings

  /**
   * The settings the map runs by: the ones it was given with the debug
   * panel's drags on top, the archive's depth resolved. Setting them applies
   * them (`setSettings`).
   */
  get settings(): ImmersiveMapSettings {
    return this.currentSettings;
  }

  set settings(settings: ImmersiveMapSettings) {
    void this.setSettings(settings);
  }

  /**
   * Applies new settings, a value or a change to the current ones
   * (`map.setSettings((s) => s.night())`), as the Swift host applies its
   * settings: the planner (`planSettingsApplication`) decides, and the map
   * takes them in place on its next frame, builds its tiles again (the
   * style, the parse, the cache, the overview), or builds its renderer
   * again (the labels, the pins, the archive, MSAA), the camera kept where
   * it is. Resolves once the settings are drawn by.
   */
  setSettings(settings: ImmersiveMapSettings | ((current: ImmersiveMapSettings) => ImmersiveMapSettings)): Promise<void> {
    const next = typeof settings === "function" ? settings(this.currentSettings) : settings;
    return this.applySettings(next);
  }

  private applySettings(requested: ImmersiveMapSettings): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    // The debug panel's drags ride on top of any settings the app gives.
    const withOverrides = this.debug.applyingOverrides(requested);
    const settings = withOverrides.resolvingArchiveDepth(this.archiveDepths.maximumZoom(archiveRevisionOf(withOverrides)));
    const previous = this.currentSettings;
    if (previous.equals(settings)) return this.recreation ?? Promise.resolve();
    this.currentSettings = settings;
    this.debug.apply(settings);
    // While a renderer is being built, it takes the latest settings once it is.
    if (this.recreation !== null) return this.recreation;
    const renderer = this.renderer;
    if (renderer === null) return Promise.resolve();
    const rebuild = resolveSettingsRebuild(renderer.settings, settings, planSettingsApplication(renderer.settings, settings));
    switch (rebuild) {
      case "none":
        return Promise.resolve();
      case "live":
        renderer.applyLiveSettings(settings);
        return Promise.resolve();
      case "tiles":
        renderer.applyLiveSettings(settings);
        renderer.rebuildTiles(settings);
        return Promise.resolve();
      case "renderer":
        return this.recreateRenderer();
    }
  }

  /**
   * The renderer built again for the current settings, the Swift
   * `recreateRenderer`: the camera's animations end (their completions
   * told), the camera stays where it is, and the controllers, the
   * listeners, the annotations and the debug panel go over to the new one.
   * Settings applied while it is built are applied to it once it is.
   */
  private recreateRenderer(): Promise<void> {
    const previous = this.renderer;
    const cameraPosition = previous?.cameraPositionForRecreation() ?? null;
    this.renderer = null;
    previous?.destroy();
    const built = this.currentSettings;
    const recreation = this.buildRenderer(built, cameraPosition, true)
      .catch((error: unknown) => {
        console.error(`ImmersiveMap could not build its renderer again: ${String(error)}`);
        this.loadingIndicator?.hide();
      })
      .then(() => {
        this.recreation = null;
        const renderer = this.renderer;
        if (renderer !== null && !this.currentSettings.equals(renderer.settings)) {
          const latest = this.currentSettings;
          this.currentSettings = renderer.settings;
          return this.applySettings(latest);
        }
        return undefined;
      });
    this.recreation = recreation;
    return recreation;
  }

  // MARK: A lost GPU device

  /**
   * The browser took the renderer's GPU device away: the renderer stopped,
   * and another is built on a new device, the camera kept where it is, as
   * for new settings (`DeviceRecovery` says when, and when to give up). A
   * hidden page is restored once it shows again, since the browser may not
   * give a hidden page a device.
   */
  private deviceLost(lost: ImmersiveMapRenderer, info: { readonly reason: string; readonly message: string }): void {
    if (this.destroyed || this.renderer !== lost) return;
    const wait = this.deviceRecovery.nextAttempt(performance.now());
    const event: ImmersiveMapDeviceLostEvent = { reason: info.reason, message: info.message, restoring: wait !== null };
    for (const listener of this.deviceLostListeners) listener(event);
    if (wait === null) {
      console.error("ImmersiveMap lost its WebGPU device too often and stops drawing.");
      this.loadingIndicator?.hide();
      return;
    }
    this.loadingIndicator?.show();
    const restore = (): void => {
      if (this.destroyed || this.renderer !== lost) return;
      void this.recreateRenderer().then(() => {
        if (this.destroyed) return;
        if (this.renderer !== null) {
          for (const listener of this.deviceRestoredListeners) listener();
        } else {
          // No renderer could be built (no adapter yet): tried again as a loss of its own.
          this.renderer = lost;
          this.deviceLost(lost, { reason: "unknown", message: "no renderer could be built on a new device" });
        }
      });
    };
    const whenShown = (): void => {
      if (!document.hidden) setTimeout(restore, wait);
      else document.addEventListener("visibilitychange", whenShown, { once: true });
    };
    whenShown();
  }

  /**
   * Every loss of the map's GPU device (`ImmersiveMapDeviceLostEvent`): the
   * map builds its renderer again on a new device and tells `onDeviceRestored`,
   * unless it lost devices too often and gave up (`restoring` false). Returns
   * the function that stops the listening.
   */
  onDeviceLost(listener: (event: ImmersiveMapDeviceLostEvent) => void): () => void {
    this.deviceLostListeners.add(listener);
    return () => this.deviceLostListeners.delete(listener);
  }

  /** The map drawing again on a new GPU device after a loss. Returns the function that stops the listening. */
  onDeviceRestored(listener: () => void): () => void {
    this.deviceRestoredListeners.add(listener);
    return () => this.deviceRestoredListeners.delete(listener);
  }

  // MARK: Debug panel

  /**
   * Installs a debug panel over the map (`ImmersiveMapDebugPanel.hud` of
   * `@artembobkin/immersive-map/debug`), the first one given kept, and switches it
   * on in the settings: the Swift `debugPanel(_:)` modifier.
   * `setSettings((s) => s.debugPanel(false))` hides it from then on.
   */
  installDebugPanel(panel: ImmersiveMapDebugPanel, options: { readonly zoomBadge?: boolean } = {}): Promise<void> {
    if (!this.debug.install(panel, this.currentSettings)) return Promise.resolve();
    return this.setSettings((settings) => settings.debugPanel(true, { zoomBadge: options.zoomBadge }));
  }

  // MARK: Camera and events

  /** Where the camera is now. */
  get view(): MapView {
    return this.renderer?.view ?? { center: [0, 0], zoom: 0, bearing: 0, pitch: 0 };
  }

  /** Puts the camera there at once: what the view leaves out stays as it is. `camera.fly` animates instead. */
  set view(view: Partial<MapView>) {
    if (this.renderer !== null) this.renderer.view = view;
  }

  /** Every drawn frame. Returns the function that stops the listening. */
  onFrame(listener: (event: FrameEvent) => void): () => void {
    return this.listen(this.frameEvents, listener);
  }

  /** Every tile that lands on the GPU. Returns the function that stops the listening. */
  onTileLoaded(listener: (event: TileLoadedEvent) => void): () => void {
    return this.listen(this.tileEvents, listener);
  }

  /**
   * The country around the point the camera looks at, mountains or a plain,
   * whenever it changes (`ImmersiveMapTerrainSurroundings`): `null` while
   * the map is off the terrain. Returns the function that stops the listening.
   */
  onTerrainSurroundingsChange(listener: (surroundings: ImmersiveMapTerrainSurroundings | null) => void): () => void {
    return this.listen(this.surroundingsEvents, listener);
  }

  /** The reading of the last frame, `null` off the terrain. */
  get terrainSurroundings(): ImmersiveMapTerrainSurroundings | null {
    return this.renderer?.terrainSurroundings ?? null;
  }

  /**
   * The selection controller the map reports to and takes commands from,
   * null for none: without one a tap selects nothing, and the tap events
   * (`onPinTap`, `onLayerTap`) still arrive.
   */
  get selection(): ImmersiveMapSelectionController | null {
    return this.selectionController;
  }

  set selection(controller: ImmersiveMapSelectionController | null) {
    this.selectionController = controller;
    if (this.renderer !== null) this.renderer.selection = controller;
  }

  /**
   * The app's handle on the tile grid, null for none. Attaching a
   * controller shows the grid: the borders of the XYZ tiles over the
   * ground, each tile's numbers written inside it, drawn over everything
   * the map draws, and a tap on a tile selecting or deselecting it (or
   * another gesture, and one tile at a time, by the settings). The
   * controller holds the selected tiles and reports every change:
   *
   * ```ts
   * const grid = new ImmersiveMapTileGridController();
   * grid.onSelectionChanged = (change) => console.log(change.selectedTiles);
   * map.tileGrid = grid;
   * map.settings = map.settings.tileGridSettings({ zoomRange: [15, 15] });
   * ```
   *
   * The grid names squares of the ground, not the tiles the map loads, so
   * it shows the tiles of any zoom whatever the archive holds. Which tiles
   * it shows and how it looks is `ImmersiveMapSettings.tileGridSettings`,
   * and what a tap may select is `ImmersiveMapSettings.tileGridSelection`.
   * For a tap that selects at once, and a second tap on the same tile that
   * deselects it however soon it comes, turn the double tap zoom off
   * (`ImmersiveMapSettings.doubleTapZoom(false)`), or select by the double
   * tap itself. While the grid shows, a tap on a tile is the grid's: it
   * ends the selection of `selection` as a tap on the bare map does, and
   * the background tap callbacks do not fire for it. Null detaches the
   * controller, and the map shows no grid. A picture and a video of the map
   * (`captureStill`, the tour video) show none either.
   */
  get tileGrid(): ImmersiveMapTileGridController | null {
    return this.tileGridController;
  }

  set tileGrid(controller: ImmersiveMapTileGridController | null) {
    this.tileGridController = controller;
    if (this.renderer !== null) this.renderer.tileGrid = controller;
  }

  /** Every tap on a pin, also on one already selected. Returns the function that stops the listening. */
  onPinTap(listener: (event: ImmersiveMapPinTapEvent) => void): () => void {
    return this.listen(this.pinTapEvents, listener);
  }

  /**
   * Every tap on a shape of a layer the map shows (`ImmersiveMapLayerTapEvent`).
   * While one listens, the shapes of the drawn layers are kept for the taps.
   * Returns the function that stops the listening.
   */
  onLayerTap(listener: (event: ImmersiveMapLayerTapEvent) => void): () => void {
    return this.listen(this.layerTapEvents, listener);
  }

  /** The app's 3D models at coordinates (`ImmersiveMapSceneModelsController`): `map.sceneModels.set([...])`. */
  get sceneModels(): ImmersiveMapSceneModelsController {
    return this.sceneModelsController;
  }

  /** Every tap on a scene model, also on one already selected. Returns the function that stops the listening. */
  onSceneModelTap(listener: (event: ImmersiveMapSceneModelTapEvent) => void): () => void {
    return this.listen(this.sceneModelTapEvents, listener);
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
      currentCameraPosition: () => this.renderer?.cameraPositionForRecreation() ?? null,
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
  async captureStill(options: Omit<ImmersiveMapStillCaptureOptions, "settings" | "pins" | "layers" | "sceneModels"> & ImmersiveMapStillEncoding = {}): Promise<Blob> {
    await this.recreation;
    const renderer = this.renderer;
    if (renderer === null) throw new Error("ImmersiveMap has no renderer to capture a still of.");
    return renderer.captureStill(options);
  }

  /** Asks for one frame, for state the map cannot see change. */
  requestFrame(): void {
    if (!this.destroyed) this.renderer?.requestFrame();
  }

  /** Tears everything down: the renderer, the listeners, the debug panel, the annotations and the canvas. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.attachedTourVideoRecorder?.detachRuntime(this);
    for (const events of this.allEvents()) {
      for (const unsubscribe of events.listeners.values()) unsubscribe();
      events.listeners.clear();
    }
    this.renderer?.destroy();
    this.renderer = null;
    this.debug.destroy();
    this.annotations.destroy();
    this.loadingIndicator?.destroy();
    this.canvas.remove();
  }
}

/** The key an archive's depth is kept under: the archive's absolute URL. */
function archiveRevisionOf(settings: ImmersiveMapSettings): string {
  return new URL(settings.tiles.network.tileArchiveURL, location.href).href;
}
