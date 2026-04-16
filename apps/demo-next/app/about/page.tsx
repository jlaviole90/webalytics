import Link from "next/link";

export default function AboutPage() {
  return (
    <main>
      <h1>About</h1>
      <p>
        Navigating here fires a second pageview. The tracker hooks into Next's
        <code> usePathname() / useSearchParams() </code>
        rather than the History API so pageviews don't double-fire.
      </p>
      <p>
        <Link href="/">&larr; Back home</Link>
      </p>
    </main>
  );
}
