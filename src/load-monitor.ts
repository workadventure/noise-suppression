/**
 * Tells whether a real-time loop keeps up: sums the time spent per frame over windows of `windowFrames` frames, and
 * reports once when two windows in a row exceeded `maxLoad` of real time. One slow window is a hiccup (a tab switch,
 * garbage collection); two are a machine that is too slow.
 */
export class LoadMonitor {
  private framesInWindow = 0;
  private busyMs = 0;
  private overloadedWindows = 0;
  private reported = false;

  constructor(
    private readonly windowFrames: number,
    private readonly frameDurationMs: number,
    private readonly maxLoad: number
  ) {}

  /** Records one frame; returns the load of the window when this frame triggers the report, undefined otherwise. */
  record(elapsedMs: number): number | undefined {
    this.busyMs += elapsedMs;
    this.framesInWindow++;
    if (this.framesInWindow < this.windowFrames) {
      return undefined;
    }
    const load = this.busyMs / (this.windowFrames * this.frameDurationMs);
    this.framesInWindow = 0;
    this.busyMs = 0;
    this.overloadedWindows = load > this.maxLoad ? this.overloadedWindows + 1 : 0;
    if (this.overloadedWindows >= 2 && !this.reported) {
      this.reported = true;
      return load;
    }
    return undefined;
  }
}

/** What the processor measured about its own cost, once, after `reportAfterWindows` windows. */
export interface LoadReport {
  /** 2 s windows measured. */
  windows: number;
  /** Median, 95th percentile and maximum of the per-window load (share of real time spent processing). */
  medianLoad: number;
  p95Load: number;
  maxLoad: number;
  /**
   * Frames measured at `slowFrameMs` or more. Worklets have no performance.now(), only Date.now() (1 ms steps), so a
   * single frame's time is only meaningful when large: one measured at 3 ms took at least 2 ms, close to the 2.67 ms of
   * a render quantum — the frames that can make the audio crackle.
   */
  slowFrames: number;
  frames: number;
}

/**
 * Collects the per-window load and the slow frames of a real-time loop, and returns a single report after
 * `reportAfterWindows` windows (then nothing). Meant for telemetry: how heavy the denoiser really is on users'
 * machines, where the overload check only says when it is too heavy.
 */
export class LoadSampler {
  private readonly windowLoads: number[] = [];
  private framesInWindow = 0;
  private busyMs = 0;
  private slowFrames = 0;
  private frames = 0;
  private reported = false;

  constructor(
    private readonly windowFrames: number,
    private readonly frameDurationMs: number,
    private readonly reportAfterWindows: number,
    private readonly slowFrameMs = 3
  ) {}

  record(elapsedMs: number): LoadReport | undefined {
    if (this.reported) {
      return undefined;
    }
    this.frames++;
    if (elapsedMs >= this.slowFrameMs) {
      this.slowFrames++;
    }
    this.busyMs += elapsedMs;
    this.framesInWindow++;
    if (this.framesInWindow < this.windowFrames) {
      return undefined;
    }
    this.windowLoads.push(this.busyMs / (this.windowFrames * this.frameDurationMs));
    this.framesInWindow = 0;
    this.busyMs = 0;
    if (this.windowLoads.length < this.reportAfterWindows) {
      return undefined;
    }
    this.reported = true;
    const sorted = [...this.windowLoads].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
    return {
      windows: sorted.length,
      medianLoad: at(0.5),
      p95Load: at(0.95),
      maxLoad: sorted[sorted.length - 1]!,
      slowFrames: this.slowFrames,
      frames: this.frames,
    };
  }
}
