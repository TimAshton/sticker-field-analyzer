# Login for this app is deliberately backed by the *same* Cognito User Pool
# the separate game-company repo provisions and owns ("one membership to
# rule them all" across all sites/games) - this repo never provisions its
# own pool, it only references game-company's pool/client IDs here, the
# same posture domain.tf takes toward the tashton.com Route 53 zone
# (reference an existing resource, never take ownership of it).
#
# These IDs are public, non-secret client config (same as
# game-company/*/src/aws-config.js), but this app's login now hard-depends
# on game-company's Cognito pool continuing to exist with these exact IDs -
# if that pool is ever destroyed or its app client recreated, login here
# breaks too. Update both values here if that ever happens.
locals {
  cognito_user_pool_id = "us-east-1_cqdC18s65"
  cognito_client_id    = "6lrk6rskght36nm51vs533745j"
  cognito_region       = "us-east-1"
}
