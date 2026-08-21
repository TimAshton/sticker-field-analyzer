import { useState, useEffect } from "react";
import { TrashIcon } from "../components/NavIcons";

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

// Admin-only QA view of the same upload list Sticker Book shows, with a
// one-click delete per tile. Deleting only removes the DynamoDB record
// (via DELETE /api/images/{id}) - the S3 image is deliberately left in
// place. Not access-controlled yet, same as the rest of /admin/*.
function AdminStickerBook() {
  const [stickers, setStickers] = useState<Sticker[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selected, setSelected] = useState<Sticker | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

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

  const deleteSticker = async (id: string) => {
    setDeletingIds((prev) => new Set(prev).add(id))
    try {
      const res = await fetch(`${PRESIGN_API_URL}/api/images/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`)
      }
      setStickers((prev) => prev.filter((s) => s.id !== id))
      setSelected((prev) => (prev?.id === id ? null : prev))
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete sticker')
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <div className="page" style={{ width: '100%' }}>
      {loading && <p>Loading stickers...</p>}
      {errorMessage && <p style={{ color: 'red' }}>Error: {errorMessage}</p>}
      {!loading && !errorMessage && stickers.length === 0 ? (
        <p>No stickers yet.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', width: '100%' }}>
          {stickers.map((sticker) => (
            <div
              key={sticker.id}
              style={{
                position: 'relative',
                lineHeight: 0,
                border: '3px solid #FF9C00', borderRadius: '8px',
                overflow: 'hidden',
                opacity: deletingIds.has(sticker.id) ? 0.4 : 1,
              }}
            >
              <button
                onClick={() => setSelected(sticker)}
                style={{
                  padding: 0, cursor: 'pointer', lineHeight: 0,
                  border: 'none', background: 'none', display: 'block', width: '100%',
                }}
              >
                <img src={sticker.imageUrl} alt="Sticker" style={{ width: '100%', display: 'block' }} />
              </button>
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
              <button
                onClick={() => deleteSticker(sticker.id)}
                disabled={deletingIds.has(sticker.id)}
                title="Delete"
                aria-label="Delete"
                style={{
                  position: 'absolute', top: '6px', left: '6px',
                  background: '#cc6666', color: '#000',
                  borderRadius: '999px', width: '1.75rem', height: '1.75rem', padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.6)', border: 'none', cursor: 'pointer',
                }}
              >
                <TrashIcon />
              </button>
            </div>
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
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => setSelected(null)}>Close</button>
              <button onClick={() => deleteSticker(selected.id)} disabled={deletingIds.has(selected.id)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminStickerBook
