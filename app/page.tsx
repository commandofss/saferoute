"use client";
import dynamic from "next/dynamic";

const MapApp = dynamic(() => import("@/components/MapApp"), {
  ssr: false,
  loading: () => <p style={{ padding: 16 }}>Loading map…</p>,
});

export default function Page() {
  return <MapApp />;
}
