import type { Metadata } from "next";
import IndustrialLoader from "./IndustrialLoader";

export const metadata: Metadata = { title: "Industrial Floor — Sleight" };

export default function Page() {
  return <IndustrialLoader />;
}
