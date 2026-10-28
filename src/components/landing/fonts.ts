import { Archivo } from "next/font/google";

/** The poster's display face: Archivo at its widest (wdth 125) and heaviest. Landing page only. */
export const archivo = Archivo({
  variable: "--font-poster",
  subsets: ["latin"],
  weight: "variable",
  axes: ["wdth"],
});
