import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom'
import Upload from './pages/Upload'
import StickerBook from './pages/StickerBook'
import AddKnown from './pages/AddKnown'
import Refs from './pages/Refs'
import AdminStickerBook from './pages/AdminStickerBook'
import AdminLayout from './components/AdminLayout'
import { UploadIcon, BookIcon, PlusIcon, FolderIcon, MagnifierIcon } from './components/NavIcons'

// One nav, not two - the admin links only join it while inside /admin/*,
// rather than rendering a second stacked nav bar there.
function Nav() {
  const { pathname } = useLocation()
  const isAdmin = pathname.startsWith('/admin')

  return (
    <nav>
      <Link to="/upload" title="Upload" aria-label="Upload"><UploadIcon /></Link>
      <Link to="/sticker-book" title="Sticker Book" aria-label="Sticker Book"><BookIcon /></Link>
      {isAdmin && (
        <>
          {/* /admin/* isn't access-controlled yet - add auth before this is public */}
          <Link to="/admin/add-known" title="Add Known" aria-label="Add Known"><PlusIcon /></Link>
          <Link to="/admin/refs" title="Refs" aria-label="Refs"><FolderIcon /></Link>
          <Link to="/admin/sticker-book" title="QA Sticker Book" aria-label="QA Sticker Book"><MagnifierIcon /></Link>
        </>
      )}
    </nav>
  )
}

function App() {
  return (
    <BrowserRouter>
      <div>
        <Nav />

        <Routes>
          <Route path="/" element={<Navigate to="/sticker-book" replace />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/sticker-book" element={<StickerBook />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="add-known" element={<AddKnown />} />
            <Route path="refs" element={<Refs />} />
            <Route path="sticker-book" element={<AdminStickerBook />} />
          </Route>
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App