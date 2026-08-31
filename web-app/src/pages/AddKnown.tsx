import { useState, type FormEvent, type ChangeEvent } from 'react'

const API_URL = import.meta.env.VITE_API_URL as string

type UploadStatus = 'idle' | 'requesting' | 'uploading' | 'success' | 'error'

function AddKnown() {
  const [file, setFile] = useState<File | null>(null)
  const [artist] = useState('unknown')
  const [designName, setDesignName] = useState('New Ref')
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [stickerId, setStickerId] = useState<string | null>(null)

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null)
    setStatus('idle')
    setErrorMessage(null)
    setStickerId(null)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!file || !artist.trim() || !designName.trim()) return

    setErrorMessage(null)

    try {
      // 1. Ask the backend for a presigned S3 upload URL for the known-sticker bucket
      setStatus('requesting')
      const presignRes = await fetch(`${API_URL}/api/get-known-presigned-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_filename: file.name,
          content_type: file.type,
          artist: artist.trim(),
          design_name: designName.trim(),
        }),
      })

      if (!presignRes.ok) {
        const body = await presignRes.json().catch(() => null)
        throw new Error(body?.detail ?? `Server returned ${presignRes.status}`)
      }

      const { upload_url, sticker_id } = await presignRes.json()

      // 2. PUT the actual file bytes directly to S3 using that URL
      setStatus('uploading')
      const uploadRes = await fetch(upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })

      if (!uploadRes.ok) {
        throw new Error(`Upload to S3 failed with status ${uploadRes.status}`)
      }

      setStickerId(sticker_id)
      setStatus('success')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
    }
  }

  const submitDisabled =
    !file || !artist.trim() || !designName.trim() || status === 'requesting' || status === 'uploading'

  return (
    <div className="page">
      <form onSubmit={handleSubmit}>
        <div>
          <input type="file" accept="image/*" onChange={handleFileChange} />
        </div>
        <div>
          <input
            type="text"
            placeholder="Design name"
            value={designName}
            onChange={(e) => setDesignName(e.target.value)}
          />
        </div>
        <button type="submit" disabled={submitDisabled}>
          {status === 'requesting' && 'Requesting upload URL...'}
          {status === 'uploading' && 'Uploading...'}
          {(status === 'idle' || status === 'success' || status === 'error') && 'Add Known Sticker'}
        </button>
      </form>

      {status === 'success' && stickerId && (
        <p>Added successfully. Sticker ID: {stickerId}</p>
      )}

      {status === 'error' && errorMessage && (
        <p style={{ color: 'red' }}>Upload failed: {errorMessage}</p>
      )}
    </div>
  )
}

export default AddKnown
