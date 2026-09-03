import type { CognitoUserSession } from 'amazon-cognito-identity-js'
import { userPool } from './cognitoUserPool'

// Set this in web-app/.env (local) and as a build-time env var in CI:
//   VITE_API_URL=https://azixo6bxwqywhz6x77arbuaetm0uuoff.lambda-url.us-west-2.on.aws
const API_URL = import.meta.env.VITE_API_URL as string

function getIdToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const cognitoUser = userPool.getCurrentUser()
    if (!cognitoUser) {
      resolve(null)
      return
    }
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null)
        return
      }
      resolve(session.getIdToken().getJwtToken())
    })
  })
}

// Thin wrapper around fetch() for calls to the api Lambda specifically -
// resolves `path` against VITE_API_URL and attaches the signed-in user's
// Cognito ID token as a Bearer header, since api/main.py now verifies it
// on every route. Not used for the separate presigned-S3 PUT requests
// (upload_url) - those are pre-signed and unrelated to Cognito auth.
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const idToken = await getIdToken()
  const headers = new Headers(options.headers)
  if (idToken) headers.set('Authorization', `Bearer ${idToken}`)
  return fetch(`${API_URL}${path}`, { ...options, headers })
}
