import { useState, useEffect } from "react";
import StickerCard from "../components/StickerCard";

const PRESIGN_API_URL = import.meta.env.VITE_PRESIGN_API_URL as string

type Sticker = { id: string; imageUrl: string }

function StickerBook() {
  const [stickers, setStickers] = useState<Sticker[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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
          data.images.map((img: { image_id: string; display_url: string }) => ({
            id: img.image_id,
            imageUrl: img.display_url,
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
    <div>
      <h1>Sticker Book</h1>
      {loading && <p>Loading stickers...</p>}
      {errorMessage && <p style={{ color: 'red' }}>Error: {errorMessage}</p>}
      {!loading && !errorMessage && stickers.length === 0 ? (
        <p>No stickers yet. Upload one to get started.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '0.5rem' }}>
          {stickers.map((sticker) => (
            <img key={sticker.id} src={sticker.imageUrl} alt="Sticker" style={{ width: '100%' }} />
          ))}
        </div>
      )}
      <StickerCard title="My First Sticker" />
    </div>
  )
}

export default StickerBook
