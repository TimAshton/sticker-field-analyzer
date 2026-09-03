import { Outlet } from 'react-router-dom'
import RequireAdmin from './RequireAdmin'

// Route composition for /admin/* - the nav itself lives in App.tsx's Nav
// component (it adds the admin links to the single shared nav while
// pathname starts with /admin), not here. RequireAuth already gated the
// /admin route in App.tsx; RequireAdmin adds the extra "admins" group check
// on top of that.
function AdminLayout() {
  return (
    <RequireAdmin>
      <Outlet />
    </RequireAdmin>
  )
}

export default AdminLayout
