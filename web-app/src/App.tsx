import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom'
import Upload from './pages/Upload'
import StickerBook from './pages/StickerBook'
import AddKnown from './pages/AddKnown'
import Refs from './pages/Refs'

function App() {
  return (
    <BrowserRouter>
      <div>
        <nav style={{ display: 'flex', gap: '1rem', padding: '1rem' }}>
          <Link to="/upload">Upload</Link>
          <Link to="/sticker-book">Sticker Book</Link>
          <Link to="/add-known">Add Known</Link>
          <Link to="/refs">Refs</Link>
        </nav>

        <Routes>
          <Route path="/" element={<Navigate to="/sticker-book" replace />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/sticker-book" element={<StickerBook />} />
          <Route path="/add-known" element={<AddKnown />} />
          <Route path="/refs" element={<Refs />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App