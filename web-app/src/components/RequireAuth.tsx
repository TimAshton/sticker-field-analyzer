import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

// Whole-app login gate - ported from game-company/member-app's
// RequireAuth.jsx. Wraps every route in App.tsx except /login itself.
function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()

  if (status === 'loading') return null
  if (status === 'signedOut') return <Navigate to="/login" replace />

  return children
}

export default RequireAuth
