import { useState, useEffect } from "react";

const PRESIGN_API_URL = import.meta.env.VITE_PRESIGN_API_URL as string

type Match = {
  stickerId: string
  artist: string
  designName: string
  similarity: number
}

type Sticker = {
  id: string
  imageUrl: string
  status: string
  createdAt: string
  matches: Match[]
}

function StickerBook() {
  const [stickers, setStickers] = useState<Sticker[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selected, setSelected] = useState<Sticker | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadImages() {
      try {
        const res = await fetch(`${PRESIGN_API_URL}/api/images`)
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`)
        }
        const data = await res.json()
        if (cancelled) return

        setStickers(
          data.images.map((img: {
            image_id: string; display_url: string; status: string; created_at: string
            matches: { sticker_id: string; artist: string; design_name: string; similarity: number }[]
          }) => ({
            id: img.image_id,
            imageUrl: img.display_url,
            status: img.status,
            createdAt: img.created_at,
            matches: (img.matches ?? []).map((m) => ({
              stickerId: m.sticker_id,
              artist: m.artist,
              designName: m.design_name,
              similarity: m.similarity,
            })),
          }))
        )
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Failed to load stickers')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadImages()
    return () => { cancelled = true }
  }, [])

  const formattedDate = (iso: string) => {
    if (!iso) return 'Unknown'
    return new Date(iso).toLocaleString()
  }

  return (
    <div className="page" style={{ width: '100%' }}>
      <p className="tagline">Stickers in the wild.</p>

      {loading && <p>Loading stickers...</p>}
      {errorMessage && <p style={{ color: 'red' }}>Error: {errorMessage}</p>}
      {!loading && !errorMessage && stickers.length === 0 ? (
        <p>No stickers yet. Upload one to get started.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', width: '100%' }}>
          {stickers.map((sticker) => (
            <button
              key={sticker.id}
              onClick={() => setSelected(sticker)}
              style={{
                position: 'relative',
                padding: 0, cursor: 'pointer', lineHeight: 0,
                border: '3px solid #FF9C00', borderRadius: '8px',
                background: 'none', overflow: 'hidden',
              }}
            >
              <img src={sticker.imageUrl} alt="Sticker" style={{ width: '100%', display: 'block' }} />
              {sticker.matches.length > 0 && (
                <span
                  title={`${sticker.matches.length} known-sticker match${sticker.matches.length === 1 ? '' : 'es'}`}
                  style={{
                    position: 'absolute', top: '6px', right: '6px',
                    background: '#FF9C00', color: '#000',
                    borderRadius: '999px', minWidth: '1.5rem', height: '1.5rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.85rem', fontWeight: 'bold', lineHeight: 1,
                    padding: '0 0.35rem', boxShadow: '0 1px 3px rgba(0,0,0,0.6)',
                  }}
                >
                  {sticker.matches.length}
                </span>
              )}
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
              alt="Sticker enlarged"
              style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
            />
            <div style={{ color: 'white' }}>
              <p>Status: {selected.status}</p>
              <p>Uploaded: {formattedDate(selected.createdAt)}</p>
              <p>ID: {selected.id}</p>
              {selected.matches.length > 0 && (
                <div>
                  <p>Matched known stickers:</p>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                    {selected.matches.map((match) => (
                      <li key={match.stickerId}>
                        {match.designName || 'Untitled'} by {match.artist || 'Unknown'} ({(match.similarity * 100).toFixed(0)}% match)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <button onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default StickerBook
