"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Workspace } from "@/lib/hand/mapping";
import { CameraError, CameraSource } from "@/lib/tracking/camera";
import { downloadRecording, PlaybackSource, Recorder } from "@/lib/tracking/playback";
import { HandProcessor } from "@/lib/tracking/processor";
import { SimulatedSource } from "@/lib/tracking/simulated";
import type { Recording, TrackingSource } from "@/lib/tracking/source";
import type { RawFrame } from "@/lib/hand/types";
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
}

const TrackingContext = createContext<TrackingApi | null>(null);

export const useTracking = () => {
  const ctx = useContext(TrackingContext);
  if (!ctx) throw new Error("useTracking must be used inside <HandTrackingProvider>");
  return ctx;
};

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
  const processor = useMemo(() => new HandProcessor(workspace), [workspace]);
  const recorder = useMemo(() => new Recorder(), []);
  const lastFrameT = useRef(0);
  const [sim, setSim] = useState<SimulatedSource | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);

  const onFrame = useCallback(
    (frame: RawFrame) => {
      recorder.push(frame);
      const hands = processor.process(frame);
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
    [processor, recorder],
  );

  const stop = useCallback(() => {
    sourceRef.current?.stop();
    sourceRef.current = null;
    setSim(null);
    setVideo(null);
    handStore.setState({ source: null, status: "idle", hands: {}, delegate: null, holding: {} });
  }, []);

  const run = useCallback(
    async (source: TrackingSource) => {
      stop();
      sourceRef.current = source;
      handStore.setState({ source: source.kind, status: "loading", error: null });
      processor.recalibrate();
      try {
        await source.start(onFrame);
        if (sourceRef.current !== source) return source.stop(); // superseded while loading
        handStore.setState({ status: "running", delegate: source.delegate ?? null });
        setVideo(source.video ?? null);
      } catch (e) {
        sourceRef.current = null;
        const denied = e instanceof CameraError && e.reason === "denied";
        handStore.setState({ status: denied ? "denied" : "error", error: (e as Error).message, source: null });
      }
    },
    [onFrame, processor, stop],
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
    }),
    [run, stop, processor, recorder, sim, video, surface],
  );

  useEffect(() => () => sourceRef.current?.stop(), []);

  // A handle for automated browser checks and the console: window.__sleight.sim.throwFlick()
  useEffect(() => {
    const w = window as unknown as { __sleight?: Record<string, unknown> };
    w.__sleight = { ...(w.__sleight ?? {}), api, store: handStore };
  }, [api]);

  return <TrackingContext.Provider value={api}>{children}</TrackingContext.Provider>;
}
