import { useState, useEffect } from "react";

const PRESIGN_API_URL = import.meta.env.VITE_PRESIGN_API_URL as string

type KnownSticker = {
  id: string
  imageUrl: string
  artist: string
  designName: string
}

// Public read-only view of the known-sticker catalog - same data and grid
// layout as the admin Refs page (pages/Refs.tsx), but trimmed to what a
// player should see: no status or raw sticker_id, since those are pipeline
// internals, not something meaningful to someone hunting stickers in the
// wild.
function Targets() {
  const [knownStickers, setKnownStickers] = useState<KnownSticker[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selected, setSelected] = useState<KnownSticker | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadKnownStickers() {
      try {
        const res = await fetch(`${PRESIGN_API_URL}/api/known-stickers`)
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`)
        }
        const data = await res.json()
        if (cancelled) return

        setKnownStickers(
          data.known_stickers.map((s: { sticker_id: string; image_url: string; artist: string; design_name: string }) => ({
            id: s.sticker_id,
            imageUrl: s.image_url,
            artist: s.artist,
            designName: s.design_name,
          }))
        )
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Failed to load targets')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadKnownStickers()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="page" style={{ width: '100%' }}>
      <p className="tagline">These are the targets. Good hunting.</p>

      {loading && <p>Loading targets...</p>}
      {errorMessage && <p style={{ color: 'red' }}>Error: {errorMessage}</p>}
      {!loading && !errorMessage && knownStickers.length === 0 ? (
        <p>No targets yet.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', width: '100%' }}>
          {knownStickers.map((sticker) => (
            <button
              key={sticker.id}
              onClick={() => setSelected(sticker)}
              style={{
                padding: 0, cursor: 'pointer', lineHeight: 0,
                border: '3px solid #FF9C00', borderRadius: '8px',
                background: 'none', overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
              }}
            >
              <img src={sticker.imageUrl} alt={sticker.designName || 'Target'} style={{ width: '100%', display: 'block' }} />
              <span style={{ lineHeight: 1.3, padding: '0.35rem', fontSize: '0.85rem', textAlign: 'center' }}>
                {sticker.designName || 'Untitled'}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1.5rem', zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            <img
              src={selected.imageUrl}
              alt={selected.designName || 'Target enlarged'}
              style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
            />
            <div style={{ color: 'white' }}>
              <p>Design: {selected.designName || 'Untitled'}</p>
              <p>Artist: {selected.artist || 'Unknown'}</p>
            </div>
            <button onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Targets
