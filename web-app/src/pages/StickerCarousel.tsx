import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ImageCarousel from "../components/ImageCarousel";
import MatchOverlayImage, { type Bbox } from "../components/MatchOverlayImage";

const PRESIGN_API_URL = import.meta.env.VITE_PRESIGN_API_URL as string

type Match = {
  stickerId: string
  artist: string
  designName: string
  similarity: number
  bbox: Bbox | null
}

type Sticker = {
  id: string
  imageUrl: string
  status: string
  createdAt: string
  matches: Match[]
}

function StickerCarousel() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
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
          data.images.map((img: {
            image_id: string; display_url: string; status: string; created_at: string
            matches: {
              sticker_id: string; artist: string; design_name: string; similarity: number
              bbox: Bbox | null
            }[]
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
              bbox: m.bbox,
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

  if (loading) return <div className="page"><p>Loading stickers...</p></div>
  if (errorMessage) return <div className="page"><p style={{ color: 'red' }}>Error: {errorMessage}</p></div>

  const index = stickers.findIndex((s) => s.id === id)
  if (index === -1) {
    return (
      <div className="page">
        <p>Sticker not found.</p>
        <button onClick={() => navigate('/sticker-book')}>Back to Sticker Book</button>
      </div>
    )
  }

  const sticker = stickers[index]
  const goTo = (i: number) => navigate(`/sticker-book/${stickers[(i + stickers.length) % stickers.length].id}`)
  const matchBoxes = sticker.matches.map((m) => m.bbox).filter((b): b is Bbox => b !== null)

  return (
    <ImageCarousel
      imageUrl={sticker.imageUrl}
      alt="Sticker enlarged"
      index={index}
      total={stickers.length}
      onPrev={() => goTo(index - 1)}
      onNext={() => goTo(index + 1)}
      closeTo="/sticker-book"
    >
      <p>Uploaded: {formattedDate(sticker.createdAt)}</p>
      {matchBoxes.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <p>Matched region{matchBoxes.length === 1 ? '' : 's'}:</p>
          <MatchOverlayImage imageUrl={sticker.imageUrl} alt="Matched regions highlighted" boxes={matchBoxes} />
        </div>
      )}
      {sticker.matches.length > 0 && (
        <div>
          <p>Matched known stickers:</p>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {sticker.matches.map((match) => (
              <li key={match.stickerId}>
                {match.designName || 'Untitled'} by {match.artist || 'Unknown'} ({(match.similarity * 100).toFixed(0)}% match)
              </li>
            ))}
          </ul>
        </div>
      )}
    </ImageCarousel>
  )
}

export default StickerCarousel
