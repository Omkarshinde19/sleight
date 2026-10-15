import type { Metadata } from "next";
import ArcadeLoader from "./ArcadeLoader";

export const metadata: Metadata = { title: "Arcade Room — Sleight" };

export default function Page() {
  return <ArcadeLoader />;
}
