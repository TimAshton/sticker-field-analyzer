import { Link, Outlet } from 'react-router-dom'
import { PlusIcon, FolderIcon } from './NavIcons'

// Local nav for the /admin/* section - not access-controlled yet, add auth
// before this is public. Kept separate from the public nav in App.tsx so
// admin-only pages don't show up there.
function AdminLayout() {
  return (
    <div>
      <nav>
        <Link to="/admin/add-known" title="Add Known" aria-label="Add Known"><PlusIcon /></Link>
        <Link to="/admin/refs" title="Refs" aria-label="Refs"><FolderIcon /></Link>
      </nav>
      <Outlet />
    </div>
  )
}

export default AdminLayout
