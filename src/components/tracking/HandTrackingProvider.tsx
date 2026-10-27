"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Workspace } from "@/lib/hand/mapping";
import { CameraError, CameraSource } from "@/lib/tracking/camera";
import { downloadRecording, PlaybackSource, Recorder } from "@/lib/tracking/playback";
import { FrameClock } from "@/lib/tracking/frameClock";
import { HandProcessor } from "@/lib/tracking/processor";
import { SimulatedSource } from "@/lib/tracking/simulated";
import type { Recording, TrackingSource } from "@/lib/tracking/source";
import type { RawFrame } from "@/lib/hand/types";
import { feel } from "@/state/feel";
import { handPose } from "@/state/handPose";
import { handStore } from "@/state/handStore";

interface TrackingApi {
  startCamera: () => Promise<void>;
  startSim: () => Promise<void>;
  startPlayback: (urlOrRecording: string | Recording) => Promise<void>;
  stop: () => void;
  recalibrate: () => void;
  toggleRecording: () => void;
  /** The simulated source while it's active (scripted moves, tests). */
  sim: SimulatedSource | null;
  video: HTMLVideoElement | null;
  workspace: Workspace;
}

const TrackingContext = createContext<TrackingApi | null>(null);

export const useTracking = () => {
  const ctx = useContext(TrackingContext);
  if (!ctx) throw new Error("useTracking must be used inside <HandTrackingProvider>");
  return ctx;
};

const SOURCE_KEY = "sleight.lastSource";

/** Remember the chosen source for this tab, so a refresh comes back to the camera. */
function rememberSource(kind: string) {
  try {
    sessionStorage.setItem(SOURCE_KEY, kind);
  } catch {
    // storage blocked: the chooser just shows again after a refresh
  }
}

/**
 * The source to resume after a refresh: the camera only if it was in use and permission is already
 * granted (so resuming never pops a permission prompt by surprise).
 */
export async function resumableSource(): Promise<"camera" | "sim" | "playback" | null> {
  let last: string | null = null;
  try {
    last = sessionStorage.getItem(SOURCE_KEY);
  } catch {
    return null;
  }
  if (last !== "camera") return last === "sim" || last === "playback" ? last : null;
  try {
    const status = await navigator.permissions?.query({ name: "camera" as PermissionName });
    return status?.state === "granted" ? "camera" : null;
  } catch {
    return null; // Safari before 16 can't query camera permission
  }
}

/** The tracker exchanged the hands' labels: the smoothed poses and the grab system follow the hands. */
function onLabelSwap() {
  handPose.swap();
  handStore.setState((s) => ({ labelSwaps: s.labelSwaps + 1 }));
}

/** Phones get one hand: two-hand tracking roughly halves the tracker's frame rate there. */
export const isTouchDevice = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/**
 * Owns the one active tracking source (camera, simulated or playback), runs every frame through the
 * HandProcessor, and publishes the result to the hand store.
 */
export function HandTrackingProvider({
  children,
  workspace,
  surface,
}: {
  children: ReactNode;
  workspace?: Workspace;
  /** Element that receives mouse/keyboard input for the simulated hand. */
  surface: React.RefObject<HTMLElement | null>;
}) {
  const sourceRef = useRef<TrackingSource | null>(null);
  const processor = useMemo(() => new HandProcessor(workspace, feel, onLabelSwap), [workspace]);
  const recorder = useMemo(() => new Recorder(), []);
  const lastFrameT = useRef(0);
  const clock = useMemo(() => new FrameClock(), []);
  const [sim, setSim] = useState<SimulatedSource | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);

  const onFrame = useCallback(
    (frame: RawFrame) => {
      recorder.push(frame);
      const hands = processor.process(frame);
      // page-clock stamps that keep the source's spacing (see FrameClock)
      handPose.push(hands, clock.stamp(frame.t, performance.now()));
      const s = handStore.getState();
      // Exponential moving averages so the numbers in the overlay are readable.
      const last = lastFrameT.current;
      lastFrameT.current = frame.t;
      const fps = last ? 1000 / Math.max(1, frame.t - last) : 0;
      handStore.setState({
        hands,
        trackerFps: s.trackerFps ? s.trackerFps * 0.9 + fps * 0.1 : fps,
        latencyMs: s.latencyMs * 0.9 + (frame.latencyMs ?? 0) * 0.1,
        calibrating: processor.isCalibrating,
      });
    },
    [processor, recorder, clock],
  );

  const stop = useCallback(() => {
    sourceRef.current?.stop();
    sourceRef.current = null;
    setSim(null);
    setVideo(null);
    handPose.reset();
    handStore.setState({ source: null, status: "idle", hands: {}, delegate: null, holding: {} });
  }, []);

  const run = useCallback(
    async (source: TrackingSource) => {
      stop();
      sourceRef.current = source;
      clock.reset();
      handStore.setState({ source: source.kind, status: "loading", error: null });
      // Fresh filters and calibration per session; the camera also restores the saved depth reference.
      processor.reset();
      handPose.handScale = processor.workspace.handScale;
      processor.setPersistence(source.kind === "camera");
      processor.setSynthetic(source.kind === "sim");
      if (source instanceof CameraSource)
        source.onError = (message) => {
          if (sourceRef.current !== source) return;
          source.stop();
          sourceRef.current = null;
          setVideo(null);
          handPose.reset();
          handStore.setState({ status: "error", error: message, source: null, hands: {} });
        };
      try {
        await source.start(onFrame);
        if (sourceRef.current !== source) return source.stop(); // superseded while loading
        handStore.setState({ status: "running", delegate: source.delegate ?? null });
        setVideo(source.video ?? null);
        rememberSource(source.kind);
      } catch (e) {
        sourceRef.current = null;
        const denied = e instanceof CameraError && e.reason === "denied";
        handStore.setState({ status: denied ? "denied" : "error", error: (e as Error).message, source: null });
      }
    },
    [onFrame, processor, stop, clock],
  );

  const api = useMemo<TrackingApi>(
    () => ({
      startCamera: () => run(new CameraSource(isTouchDevice() ? 1 : 2)),
      startSim: async () => {
        if (!surface.current) return;
        const s = new SimulatedSource(surface.current, !isTouchDevice());
        await run(s);
        setSim(s);
      },
      startPlayback: async (src) =>
        run(typeof src === "string" ? await PlaybackSource.fromUrl(src) : new PlaybackSource(src)),
      stop,
      recalibrate: () => processor.recalibrate(),
      toggleRecording: () => {
        if (recorder.active) {
          const rec = recorder.stop();
          if (rec.frames.length) downloadRecording(rec);
          handStore.setState({ recording: false });
        } else {
          recorder.start();
          handStore.setState({ recording: true });
        }
      },
      sim,
      video,
      workspace: processor.workspace,
    }),
    [run, stop, processor, recorder, sim, video, surface],
  );

  useEffect(() => () => sourceRef.current?.stop(), []);

  // A handle for automated browser checks and the console: window.__sleight.sim.throwFlick()
  useEffect(() => {
    const w = window as unknown as { __sleight?: Record<string, unknown> };
    w.__sleight = { ...(w.__sleight ?? {}), api, store: handStore, feel, pose: handPose };
  }, [api]);

  return <TrackingContext.Provider value={api}>{children}</TrackingContext.Provider>;
}
