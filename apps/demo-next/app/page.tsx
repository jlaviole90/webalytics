import Link from "next/link";
import { TrackButton } from "./track-button";

export default function HomePage() {
  return (
    <main>
      <h1>Webalytics demo</h1>
      <p>
        This page is wired up to <code>@webalytics/tracker-next</code>. The
        pageview for this route fired when you loaded; click-through to{" "}
        <Link href="/about">/about</Link> will fire another via Next's App
        Router, not via History API patching.
      </p>
      <p>
        Click the button to emit a custom <code>signup</code> event with a
        small props payload. Open the network tab and watch
        <code> POST /collect</code> go out.
      </p>
      <TrackButton />
      <p style={{ marginTop: 32, fontSize: 14, color: "#555" }}>
        Env: <code>NEXT_PUBLIC_WEBALYTICS_SITE_ID</code> and{" "}
        <code>NEXT_PUBLIC_WEBALYTICS_HOST</code> come from{" "}
        <code>docker-compose.yml</code>.
      </p>
    </main>
  );
}
