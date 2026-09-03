import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import type { CognitoUser } from 'amazon-cognito-identity-js'
import { useAuth } from '../context/useAuth'

// Sign-in only - account creation stays on game-company's public-app
// (the pool's post_confirmation Lambda auto-adds new signups to the
// shared "members" group), so this page just links out to it rather than
// duplicating that signup/confirmation flow here.
const SIGNUP_URL = 'https://games.tashton.com/join'

function Login() {
  const { status, signIn, completeNewPassword } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pendingUser, setPendingUser] = useState<CognitoUser | null>(null)
  const [error, setError] = useState('')

  if (status === 'signedIn') return <Navigate to="/" replace />

  async function handleSignIn(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const result = await signIn(email, password)
      if (result.challenge === 'NEW_PASSWORD_REQUIRED') {
        setPendingUser(result.cognitoUser)
      } else {
        navigate('/')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    }
  }

  async function handleNewPassword(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!pendingUser) return
    try {
      await completeNewPassword(pendingUser, newPassword)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set new password')
    }
  }

  if (pendingUser) {
    return (
      <div className="page">
        <form onSubmit={handleNewPassword}>
          <h1>Set a new password</h1>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            autoComplete="new-password"
            required
          />
          <button type="submit">Set password</button>
          {error && <p style={{ color: 'red' }}>{error}</p>}
        </form>
      </div>
    )
  }

  return (
    <div className="page">
      <form onSubmit={handleSignIn}>
        <h1>Sign in</h1>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="username"
          required
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          required
        />
        <button type="submit">Sign in</button>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </form>
      <p>
        Need an account? <a href={SIGNUP_URL}>Sign up</a>
      </p>
    </div>
  )
}

export default Login
