/**
 * Renders a JSON-LD block. Structured data is what gets the site rich results
 * for software, FAQ, and breadcrumb queries.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // The payload is built from static site constants, never user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
