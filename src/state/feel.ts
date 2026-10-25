import { FeelMeter } from "@/lib/hand/feel";
import { COAST_MS } from "@/lib/tracking/processor";

/** The live session's feel metrics (debug overlay, grab system, window.__sleight.feel). */
export const feel = new FeelMeter(COAST_MS);
