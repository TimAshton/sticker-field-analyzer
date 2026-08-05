import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import Upload from './pages/Upload'
import StickerBook from './pages/StickerBook'

function App() {
  return (
    <BrowserRouter>
      <div>
        <nav style={{ display: 'flex', gap: '1rem', padding: '1rem' }}>
          <Link to="/">Home</Link>
          <Link to="/upload">Upload</Link>
          <Link to="/sticker-book">Sticker Book</Link>
        </nav>

        <Routes>
          <Route path="/" element={<div>Sticker Field App</div>} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/sticker-book" element={<StickerBook />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App