import type { Metadata } from "next";
import TheatreLoader from "./TheatreLoader";

export const metadata: Metadata = { title: "Operating Theatre — Sleight" };

export default function Page() {
  return <TheatreLoader />;
}
