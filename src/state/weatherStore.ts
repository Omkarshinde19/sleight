import { create } from "zustand";

export type WeatherKind = "clear" | "rain" | "snow";

interface WeatherState {
  kind: WeatherKind;
  /** How wet / snowed-on the hands are right now, 0 … 1 (for the HUD). */
  wetness: number;
  snow: number;
  setKind: (k: WeatherKind) => void;
}

export const useWeather = create<WeatherState>((set) => ({
  kind: "clear",
  wetness: 0,
  snow: 0,
  setKind: (kind) => set({ kind }),
}));
