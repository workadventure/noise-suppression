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
