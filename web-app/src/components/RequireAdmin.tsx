import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

// Extra gate for /admin/* on top of RequireAuth - ported from
// game-company/admin-app's RequireAdmin.jsx. Requires the signed-in
// account to be in the shared pool's "admins" group, not just "members".
function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, groups, signOut } = useAuth()

  if (status === 'loading') return null
  if (status === 'signedOut') return <Navigate to="/login" replace />

  if (!groups.includes('admins')) {
    return (
      <div className="page">
        <p>Signed in, but this account isn't an admin.</p>
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </div>
    )
  }

  return children
}

export default RequireAdmin
