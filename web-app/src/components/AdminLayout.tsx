import { Outlet } from 'react-router-dom'

// Pure route composition for /admin/* - the nav itself lives in App.tsx's
// Nav component (it adds the admin links to the single shared nav while
// pathname starts with /admin), not here. Kept as its own layout route so
// an auth check has an obvious place to go later.
function AdminLayout() {
  return <Outlet />
}

export default AdminLayout
