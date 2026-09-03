import { useEffect, useState, type ReactNode } from 'react'
import { AuthenticationDetails, CognitoUser, type CognitoUserSession } from 'amazon-cognito-identity-js'
import { userPool } from '../lib/cognitoUserPool'
import { AuthContext, type AuthStatus, type SignInResult } from './authContext'

function groupsFromSession(session: CognitoUserSession): string[] {
  return (session.getIdToken().decodePayload()['cognito:groups'] as string[] | undefined) ?? []
}

// Ported from game-company/member-app's AuthContext.jsx - same shape
// (status/email/groups + signIn/completeNewPassword/signOut), just typed.
// This is the first React context in this codebase.
export function AuthProvider({ children }: { children: ReactNode }) {
  // Lazy initializer resolves the synchronous "no signed-in user at all"
  // case up front, so the effect below only ever calls setState from
  // inside the async getSession callback (an external-system callback),
  // never synchronously from the effect body itself.
  const [status, setStatus] = useState<AuthStatus>(() =>
    userPool.getCurrentUser() ? 'loading' : 'signedOut'
  )
  const [email, setEmail] = useState<string | null>(null)
  const [groups, setGroups] = useState<string[]>([])

  useEffect(() => {
    const cognitoUser = userPool.getCurrentUser()
    if (!cognitoUser) return

    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        setStatus('signedOut')
        return
      }
      setEmail(cognitoUser.getUsername())
      setGroups(groupsFromSession(session))
      setStatus('signedIn')
    })
  }, [])

  function signIn(username: string, password: string): Promise<SignInResult> {
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({ Username: username, Pool: userPool })
      const authDetails = new AuthenticationDetails({ Username: username, Password: password })

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session) => {
          setEmail(username)
          setGroups(groupsFromSession(session))
          setStatus('signedIn')
          resolve({ challenge: null })
        },
        onFailure: reject,
        newPasswordRequired: () => {
          resolve({ challenge: 'NEW_PASSWORD_REQUIRED', cognitoUser })
        },
      })
    })
  }

  function completeNewPassword(cognitoUser: CognitoUser, newPassword: string): Promise<void> {
    return new Promise((resolve, reject) => {
      cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
        onSuccess: (session) => {
          setEmail(cognitoUser.getUsername())
          setGroups(groupsFromSession(session))
          setStatus('signedIn')
          resolve()
        },
        onFailure: reject,
      })
    })
  }

  function signOut() {
    const cognitoUser = userPool.getCurrentUser()
    if (cognitoUser) cognitoUser.signOut()
    setEmail(null)
    setGroups([])
    setStatus('signedOut')
  }

  return (
    <AuthContext.Provider value={{ status, email, groups, signIn, completeNewPassword, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
