"use client";

import dynamic from "next/dynamic";
import { SceneLoading } from "@/components/scene/SceneLoading";

const ArcadeScene = dynamic(() => import("@/scenes/arcade/ArcadeScene"), { ssr: false, loading: () => <SceneLoading title="Arcade Room" /> });

export default function ArcadeLoader() {
  return <ArcadeScene />;
}
