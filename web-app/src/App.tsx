import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom'
import Upload from './pages/Upload'
import StickerBook from './pages/StickerBook'
import AddKnown from './pages/AddKnown'
import Refs from './pages/Refs'
import { UploadIcon, BookIcon, PlusIcon, FolderIcon } from './components/NavIcons'

function App() {
  return (
    <BrowserRouter>
      <div>
        <nav>
          <Link to="/upload" title="Upload" aria-label="Upload"><UploadIcon /></Link>
          <Link to="/sticker-book" title="Sticker Book" aria-label="Sticker Book"><BookIcon /></Link>
          {/* /admin/* routes aren't access-controlled yet - add auth before this is public */}
          <Link to="/admin/add-known" title="Add Known" aria-label="Add Known"><PlusIcon /></Link>
          <Link to="/admin/refs" title="Refs" aria-label="Refs"><FolderIcon /></Link>
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