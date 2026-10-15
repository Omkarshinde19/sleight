import type { Metadata } from "next";
import LabLoader from "./LabLoader";

export const metadata: Metadata = { title: "Lab — Sleight" };

export default function Page() {
  return <LabLoader />;
}
