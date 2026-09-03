import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom'
import Upload from './pages/Upload'
import StickerBook from './pages/StickerBook'
import StickerCarousel from './pages/StickerCarousel'
import Targets from './pages/Targets'
import AddKnown from './pages/AddKnown'
import Refs from './pages/Refs'
import RefsCarousel from './pages/RefsCarousel'
import AdminStickerBook from './pages/AdminStickerBook'
import AdminStickerCarousel from './pages/AdminStickerCarousel'
import Login from './pages/Login'
import AdminLayout from './components/AdminLayout'
import RequireAuth from './components/RequireAuth'
import { AuthProvider } from './context/AuthProvider'
import { UploadIcon, BookIcon, PlusIcon, FolderIcon, MagnifierIcon, CrosshairIcon } from './components/NavIcons'

// One nav, showing only the links relevant to the current section - the
// public links (Upload, Sticker Book, Targets) and admin links (Add Known,
// Refs, QA Sticker Book) never show together.
function Nav() {
  const { pathname } = useLocation()
  const isAdmin = pathname.startsWith('/admin')

  if (isAdmin) {
    return (
      <nav>
        <Link to="/admin/add-known" title="Add Known" aria-label="Add Known"><PlusIcon /></Link>
        <Link to="/admin/refs" title="Refs" aria-label="Refs"><FolderIcon /></Link>
        <Link to="/admin/sticker-book" title="QA Sticker Book" aria-label="QA Sticker Book"><MagnifierIcon /></Link>
      </nav>
    )
  }

  return (
    <nav>
      <Link to="/upload" title="Upload" aria-label="Upload"><UploadIcon /></Link>
      <Link to="/sticker-book" title="Sticker Book" aria-label="Sticker Book"><BookIcon /></Link>
      <Link to="/targets" title="Targets" aria-label="Targets"><CrosshairIcon /></Link>
    </nav>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div>
          <Nav />

          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<RequireAuth><Navigate to="/sticker-book" replace /></RequireAuth>} />
            <Route path="/upload" element={<RequireAuth><Upload /></RequireAuth>} />
            <Route path="/sticker-book" element={<RequireAuth><StickerBook /></RequireAuth>} />
            <Route path="/sticker-book/:id" element={<RequireAuth><StickerCarousel /></RequireAuth>} />
            <Route path="/targets" element={<RequireAuth><Targets /></RequireAuth>} />
            {/* AdminLayout itself adds the extra "admins" group check (RequireAdmin) on top of this */}
            <Route path="/admin" element={<RequireAuth><AdminLayout /></RequireAuth>}>
              <Route path="add-known" element={<AddKnown />} />
              <Route path="refs" element={<Refs />} />
              <Route path="refs/:id" element={<RefsCarousel />} />
              <Route path="sticker-book" element={<AdminStickerBook />} />
              <Route path="sticker-book/:id" element={<AdminStickerCarousel />} />
            </Route>
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App