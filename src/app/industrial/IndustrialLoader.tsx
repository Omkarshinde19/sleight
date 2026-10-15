"use client";

import dynamic from "next/dynamic";
import { SceneLoading } from "@/components/scene/SceneLoading";

const IndustrialScene = dynamic(() => import("@/scenes/industrial/IndustrialScene"), { ssr: false, loading: () => <SceneLoading title="Industrial Floor" /> });

export default function IndustrialLoader() {
  return <IndustrialScene />;
}
