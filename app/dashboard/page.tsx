import type { Metadata, Viewport } from "next";
import { config } from "@/lib/config";
import Dashboard from "./Dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Money dashboard", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0d0d0d" };

export default function Page() {
  const demo = config.dashDemo;
  const liffId = demo ? "" : process.env.NEXT_PUBLIC_LIFF_ID ?? "";
  if (!demo && !liffId) {
    return <p style={{ padding: 24, fontFamily: "system-ui" }}>Set NEXT_PUBLIC_LIFF_ID and LINE_LOGIN_CHANNEL_ID to use the dashboard. See README.</p>;
  }
  return (
    <>
      {/* Dark by default; apply the saved choice before first paint to avoid a flash */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{document.documentElement.dataset.theme=localStorage.getItem("dash-theme")==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`,
        }}
      />
      <Dashboard liffId={liffId} demo={demo} />
    </>
  );
}
