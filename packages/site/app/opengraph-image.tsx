import { ImageResponse } from 'next/og';
import { siteName, siteTagline } from '@/lib/site';

export const alt = `${siteName} — ${siteTagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Social card shared by every page that does not define its own. Kept to
 * shapes and text so it renders without loading external fonts or images.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #0e3233 0%, #0a6f73 55%, #37a987 100%)',
          padding: 72,
          color: '#f0fffb',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: '#f0fffb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0a6f73',
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            ER
          </div>
          <div style={{ fontSize: 26, letterSpacing: 1, opacity: 0.9 }}>
            Dynamics 365 Finance &amp; Operations
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1 }}>
            {siteName}
          </div>
          <div style={{ marginTop: 24, fontSize: 32, lineHeight: 1.35, opacity: 0.92 }}>
            Trace Electronic Reporting bindings from format element to table — in the browser.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, fontSize: 22, opacity: 0.85 }}>
          <span>Data models</span>
          <span>·</span>
          <span>Model mappings</span>
          <span>·</span>
          <span>Formats</span>
        </div>
      </div>
    ),
    size
  );
}
