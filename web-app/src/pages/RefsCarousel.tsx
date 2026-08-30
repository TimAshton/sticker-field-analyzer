import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ImageCarousel from "../components/ImageCarousel";

const PRESIGN_API_URL = import.meta.env.VITE_PRESIGN_API_URL as string

type KnownSticker = {
  id: string
  imageUrl: string
  artist: string
  designName: string
  status: string
  createdAt: string
}

function RefsCarousel() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [knownStickers, setKnownStickers] = useState<KnownSticker[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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

  const formattedDate = (iso: string) => {
    if (!iso) return 'Unknown'
    return new Date(iso).toLocaleString()
  }

  if (loading) return <div className="page"><p>Loading known stickers...</p></div>
  if (errorMessage) return <div className="page"><p style={{ color: 'red' }}>Error: {errorMessage}</p></div>

  const index = knownStickers.findIndex((s) => s.id === id)
  if (index === -1) {
    return (
      <div className="page">
        <p>Known sticker not found.</p>
        <button onClick={() => navigate('/admin/refs')}>Back to Refs</button>
      </div>
    )
  }

  const sticker = knownStickers[index]
  const goTo = (i: number) => navigate(`/admin/refs/${knownStickers[(i + knownStickers.length) % knownStickers.length].id}`)

  return (
    <ImageCarousel
      imageUrl={sticker.imageUrl}
      alt={sticker.designName || 'Known sticker enlarged'}
      index={index}
      total={knownStickers.length}
      onPrev={() => goTo(index - 1)}
      onNext={() => goTo(index + 1)}
      closeTo="/admin/refs"
    >
      <p>Design: {sticker.designName || 'Untitled'}</p>
      <p>Artist: {sticker.artist || 'Unknown'}</p>
      <p>Status: {sticker.status}</p>
      <p>Added: {formattedDate(sticker.createdAt)}</p>
      <p>ID: {sticker.id}</p>
    </ImageCarousel>
  )
}

export default RefsCarousel
