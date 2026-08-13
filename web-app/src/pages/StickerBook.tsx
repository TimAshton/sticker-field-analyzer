import { useState, useEffect } from "react";
import StickerCard from "../components/StickerCard";

const PRESIGN_API_URL = import.meta.env.VITE_PRESIGN_API_URL as string

type Sticker = {
  id: string
  imageUrl: string
  status: string
  createdAt: string
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
          data.images.map((img: { image_id: string; display_url: string; status: string; created_at: string }) => ({
            id: img.image_id,
            imageUrl: img.display_url,
            status: img.status,
            createdAt: img.created_at,
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
    <div>
      <h1>Sticker Book</h1>
      {loading && <p>Loading stickers...</p>}
      {errorMessage && <p style={{ color: 'red' }}>Error: {errorMessage}</p>}
      {!loading && !errorMessage && stickers.length === 0 ? (
        <p>No stickers yet. Upload one to get started.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
          {stickers.map((sticker) => (
            <button
              key={sticker.id}
              onClick={() => setSelected(sticker)}
              style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', lineHeight: 0 }}
            >
              <img src={sticker.imageUrl} alt="Sticker" style={{ width: '100%', display: 'block' }} />
            </button>
          ))}
        </div>
      )}
      <StickerCard title="My First Sticker" />

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
            </div>
            <button onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default StickerBook
