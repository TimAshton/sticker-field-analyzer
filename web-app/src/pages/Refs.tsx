import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from '../lib/api'

type KnownSticker = {
  id: string
  imageUrl: string
  artist: string
  designName: string
  status: string
  createdAt: string
}

function Refs() {
  const [knownStickers, setKnownStickers] = useState<KnownSticker[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadKnownStickers() {
      try {
        const res = await apiFetch('/api/known-stickers')
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`)
        }
        const data = await res.json()
        if (cancelled) return

        setKnownStickers(
          data.known_stickers.map((s: { sticker_id: string; image_url: string; artist: string; design_name: string; status: string; created_at: string }) => ({
            id: s.sticker_id,
            imageUrl: s.image_url,
            artist: s.artist,
            designName: s.design_name,
            status: s.status,
            createdAt: s.created_at,
          }))
        )
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Failed to load known stickers')
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
      {loading && <p>Loading known stickers...</p>}
      {errorMessage && <p style={{ color: 'red' }}>Error: {errorMessage}</p>}
      {!loading && !errorMessage && knownStickers.length === 0 ? (
        <p>No known stickers yet. Add one to get started.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', width: '100%' }}>
          {knownStickers.map((sticker) => (
            <Link
              key={sticker.id}
              to={`/admin/refs/${sticker.id}`}
              style={{
                padding: 0, cursor: 'pointer', lineHeight: 0,
                border: '3px solid #FF9C00', borderRadius: '8px',
                background: 'none', overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
              }}
            >
              <img src={sticker.imageUrl} alt={sticker.designName || 'Known sticker'} style={{ width: '100%', display: 'block' }} />
              <span style={{ lineHeight: 1.3, padding: '0.35rem', fontSize: '0.85rem', textAlign: 'center' }}>
                {sticker.designName || 'Untitled'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default Refs
