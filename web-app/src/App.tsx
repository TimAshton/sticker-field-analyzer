import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom'
import Upload from './pages/Upload'
import StickerBook from './pages/StickerBook'
import AddKnown from './pages/AddKnown'
import Refs from './pages/Refs'

function App() {
  return (
    <BrowserRouter>
      <div>
        <nav style={{ display: 'flex', gap: '1rem', padding: '1rem', fontSize: '1.5rem' }}>
          <Link to="/upload" title="Upload" aria-label="Upload">📤</Link>
          <Link to="/sticker-book" title="Sticker Book" aria-label="Sticker Book">📖</Link>
          {/* /admin/* routes aren't access-controlled yet - add auth before this is public */}
          <Link to="/admin/add-known" title="Add Known" aria-label="Add Known">➕</Link>
          <Link to="/admin/refs" title="Refs" aria-label="Refs">🗂️</Link>
        </nav>

        <Routes>
          <Route path="/" element={<Navigate to="/sticker-book" replace />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/sticker-book" element={<StickerBook />} />
          <Route path="/admin/add-known" element={<AddKnown />} />
          <Route path="/admin/refs" element={<Refs />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App