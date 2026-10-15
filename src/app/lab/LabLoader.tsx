"use client";

import dynamic from "next/dynamic";
import { SceneLoading } from "@/components/scene/SceneLoading";

const LabScene = dynamic(() => import("@/scenes/lab/LabScene"), { ssr: false, loading: () => <SceneLoading title="Lab" /> });

export default function LabLoader() {
  return <LabScene />;
}
