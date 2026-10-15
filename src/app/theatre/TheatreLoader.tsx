"use client";

import dynamic from "next/dynamic";
import { SceneLoading } from "@/components/scene/SceneLoading";

const TheatreScene = dynamic(() => import("@/scenes/theatre/TheatreScene"), { ssr: false, loading: () => <SceneLoading title="Operating Theatre" /> });

export default function TheatreLoader() {
  return <TheatreScene />;
}
