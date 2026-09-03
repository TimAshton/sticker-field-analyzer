import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from '../lib/api'

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

  useEffect(() => {
    let cancelled = false

    async function loadImages() {
      try {
        const res = await apiFetch('/api/images')
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
            <Link
              key={sticker.id}
              to={`/sticker-book/${sticker.id}`}
              style={{
                position: 'relative',
                padding: 0, cursor: 'pointer', lineHeight: 0,
                border: '3px solid #FF9C00', borderRadius: '8px',
                background: 'none', overflow: 'hidden', display: 'block',
              }}
            >
              <img
                src={sticker.imageUrl}
                alt="Sticker"
                style={{
                  width: '100%', display: 'block',
                  filter: sticker.matches.length === 0 ? 'grayscale(1)' : undefined,
                }}
              />
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
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default StickerBook
