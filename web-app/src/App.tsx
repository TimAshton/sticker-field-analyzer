import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom'
import Upload from './pages/Upload'
import StickerBook from './pages/StickerBook'
import AddKnown from './pages/AddKnown'
import Refs from './pages/Refs'
import AdminLayout from './components/AdminLayout'
import { UploadIcon, BookIcon } from './components/NavIcons'

function App() {
  return (
    <BrowserRouter>
      <div>
        <nav>
          <Link to="/upload" title="Upload" aria-label="Upload"><UploadIcon /></Link>
          <Link to="/sticker-book" title="Sticker Book" aria-label="Sticker Book"><BookIcon /></Link>
        </nav>

        <Routes>
          <Route path="/" element={<Navigate to="/sticker-book" replace />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/sticker-book" element={<StickerBook />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="add-known" element={<AddKnown />} />
            <Route path="refs" element={<Refs />} />
          </Route>
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App