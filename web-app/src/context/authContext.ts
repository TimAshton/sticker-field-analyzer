import { createContext } from 'react'
import type { CognitoUser } from 'amazon-cognito-identity-js'

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn'

export type SignInResult =
  | { challenge: null }
  | { challenge: 'NEW_PASSWORD_REQUIRED'; cognitoUser: CognitoUser }

export type AuthContextValue = {
  status: AuthStatus
  email: string | null
  groups: string[]
  signIn: (username: string, password: string) => Promise<SignInResult>
  completeNewPassword: (cognitoUser: CognitoUser, newPassword: string) => Promise<void>
  signOut: () => void
}

// Split out from AuthContext.tsx/useAuth.ts - react-refresh/only-export-components
// wants files that export a component to export only components, so
// everything non-component (the context object and its types) lives here.
export const AuthContext = createContext<AuthContextValue | null>(null)
