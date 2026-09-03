import { CognitoUserPool } from 'amazon-cognito-identity-js'

// Points at the *same* Cognito User Pool the game-company repo's apps use -
// "one membership to rule them all" rather than a pool of our own. See
// terraform/environments/dev/auth.tf for why this repo doesn't provision
// its own pool. Set VITE_COGNITO_USER_POOL_ID/VITE_COGNITO_CLIENT_ID in
// web-app/.env (local) and as build-time env vars in CI. No Region field
// needed here - CognitoUserPool derives it from the pool id's prefix.
export const userPool = new CognitoUserPool({
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID as string,
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID as string,
})
