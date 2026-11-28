// Copyright (c) 2025-2026 Artem Bobkin.
// SPDX-License-Identifier: MIT

/** How long the map may take to start before the indicator shows, in milliseconds: a quick start shows none. */
const SHOW_DELAY_MILLISECONDS = 200;

/**
 * The sign that the map is starting: a ring that turns in the middle of the
 * map's container, over the canvas, while the map has no renderer that drew
 * a frame. That is the start (the GPU device, the Wasm modules, the tile
 * workers, with the attempts a refusing GPU takes: `acquireGpuDevice`) and
 * the time a renderer is built again after a lost device
 * (`DeviceRecovery`). A grey that reads on a light page and on a dark one.
 * It takes no pointer events and is hidden from assistive technology's tree
 * but for its `role="progressbar"` label.
 */
export class LoadingIndicator {
  readonly element: HTMLDivElement;
  private shown = false;
  private spin: Animation | null = null;
  private fade: Animation | null = null;

  /** Builds the indicator, hidden, and puts it right after `after`, the map's canvas, in the map's container. */
  constructor(after: Element) {
    const element = document.createElement("div");
    element.className = "immersive-map-loading";
    element.dataset.immersiveMapLoading = "";
    element.setAttribute("role", "progressbar");
    element.setAttribute("aria-label", "Loading the map");
    element.style.cssText = "position:absolute;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none";
    const ring = document.createElement("div");
    ring.style.cssText = [
      "box-sizing:border-box",
      "width:32px",
      "height:32px",
      "border-radius:50%",
      "border:3px solid rgba(128,128,128,0.3)",
      "border-top-color:rgba(128,128,128,0.95)",
    ].join(";");
    element.append(ring);
    after.after(element);
    this.element = element;
  }

  /** Shows the ring, after the delay a quick start is spared it by. A no-op while shown. */
  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.element.style.display = "flex";
    const ring = this.element.firstElementChild!;
    this.spin = ring.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 900, iterations: Infinity });
    this.fade = this.element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay: SHOW_DELAY_MILLISECONDS, fill: "backwards" });
  }

  /** Hides the ring. A no-op while hidden. */
  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.spin?.cancel();
    this.fade?.cancel();
    this.spin = this.fade = null;
    this.element.style.display = "none";
  }

  destroy(): void {
    this.hide();
    this.element.remove();
  }
}
