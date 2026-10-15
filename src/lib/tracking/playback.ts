import type { RawFrame } from "../hand/types";
import type { Recording, TrackingSource } from "./source";

/** Loops a recorded session in real time. */
export class PlaybackSource implements TrackingSource {
  readonly kind = "playback";
  private raf = 0;
  private running = false;

  constructor(private recording: Recording) {}

  static async fromUrl(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't load recording ${url} (${res.status})`);
    return new PlaybackSource(parseRecording(await res.json()));
  }

  async start(emit: (frame: RawFrame) => void) {
    const frames = this.recording.frames;
    if (!frames.length) return;
    const t0 = frames[0].t;
    const duration = frames[frames.length - 1].t - t0 + 33;
    const startedAt = performance.now();
    let i = 0;
    let loop = 0;
    this.running = true;

    const tick = () => {
      if (!this.running) return;
      const elapsed = performance.now() - startedAt;
      const thisLoop = Math.floor(elapsed / duration);
      if (thisLoop !== loop) {
        loop = thisLoop;
        i = 0;
      }
      const local = elapsed - loop * duration;
      // Emit every frame whose time has come (usually one per tick).
      let last: RawFrame | null = null;
      while (i < frames.length && frames[i].t - t0 <= local) last = frames[i++];
      if (last) emit({ ...last, t: startedAt + loop * duration + (last.t - t0) });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}

export function parseRecording(data: unknown): Recording {
  const r = data as Partial<Recording>;
  if (r?.version !== 1 || !Array.isArray(r.frames)) throw new Error("Not a Sleight recording (expected version 1).");
  return { version: 1, aspect: r.aspect ?? 4 / 3, recordedAt: r.recordedAt ?? "", frames: r.frames };
}

/** Collects raw frames while recording and saves them as JSON. */
export class Recorder {
  private frames: RawFrame[] = [];
  private aspect = 4 / 3;
  active = false;

  start() {
    this.frames = [];
    this.active = true;
  }

  push(frame: RawFrame) {
    if (!this.active) return;
    this.aspect = frame.aspect;
    // Round to 5 decimals: ~10x smaller files, far below tracker noise.
    const r = (v: number) => Math.round(v * 1e5) / 1e5;
    const p = ({ x, y, z }: { x: number; y: number; z: number }) => ({ x: r(x), y: r(y), z: r(z) });
    this.frames.push({
      t: Math.round(frame.t),
      aspect: frame.aspect,
      hands: frame.hands.map((h) => ({ ...h, score: r(h.score), landmarks: h.landmarks.map(p), worldLandmarks: h.worldLandmarks.map(p) })),
    });
  }

  stop(): Recording {
    this.active = false;
    return { version: 1, aspect: this.aspect, recordedAt: new Date().toISOString(), frames: this.frames };
  }
}

export function downloadRecording(rec: Recording, name = `sleight-session-${Date.now()}.json`) {
  const blob = new Blob([JSON.stringify(rec)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
