import { useState, type FormEvent, type ChangeEvent } from 'react'

// Set this in web-app/.env (local) and as a build-time env var in CI:
//   VITE_PRESIGN_API_URL=https://6hbbhppr54ze25qdrsabg6wanm0iwzja.lambda-url.us-west-2.on.aws
const PRESIGN_API_URL = import.meta.env.VITE_PRESIGN_API_URL as string

type UploadStatus = 'idle' | 'requesting' | 'uploading' | 'success' | 'error'

function Upload() {
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [objectKey, setObjectKey] = useState<string | null>(null)

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null)
    setStatus('idle')
    setErrorMessage(null)
    setObjectKey(null)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!file) return

    setErrorMessage(null)

    try {
      // 1. Ask the backend for a presigned S3 upload URL
      setStatus('requesting')
      const presignRes = await fetch(`${PRESIGN_API_URL}/api/get-presigned-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_filename: file.name,
          content_type: file.type,
        }),
      })

      if (!presignRes.ok) {
        const body = await presignRes.json().catch(() => null)
        throw new Error(body?.detail ?? `Server returned ${presignRes.status}`)
      }

      const { upload_url, object_key } = await presignRes.json()

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

      setObjectKey(object_key)
      setStatus('success')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
    }
  }

  return (
    <div className="page">
      <form onSubmit={handleSubmit}>
        <input type="file" accept="image/*" onChange={handleFileChange} />
        <button type="submit" disabled={!file || status === 'requesting' || status === 'uploading'}>
          {status === 'requesting' && 'Requesting upload URL...'}
          {status === 'uploading' && 'Uploading...'}
          {(status === 'idle' || status === 'success' || status === 'error') && 'Upload'}
        </button>
      </form>

      {status === 'success' && objectKey && (
        <p>Uploaded successfully. Object key: {objectKey}</p>
      )}

      {status === 'error' && errorMessage && (
        <p style={{ color: 'red' }}>Upload failed: {errorMessage}</p>
      )}
    </div>
  )
}

export default Upload