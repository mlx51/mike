# prints a fresh access token for the throwaway user: GoTrue admin magic link, then /verify
S=/private/tmp/claude-501/-Users-amalanandmuthukumaran-dev-mike/2048f652-5248-473c-9c9e-4d079c852cef/scratchpad
SK=$(grep ^SUPABASE_SECRET_KEY= $S/e776.env | cut -d= -f2-)
H=$(curl -s -X POST http://127.0.0.1:54321/auth/v1/admin/generate_link -H "apikey: $SK" -H "Authorization: Bearer $SK" -H 'content-type: application/json' \
  -d "{\"type\":\"magiclink\",\"email\":\"$(cat $S/u776.email)\"}" | jq -r '.hashed_token // .properties.hashed_token')
curl -s -X POST http://127.0.0.1:54321/auth/v1/verify -H "apikey: $SK" -H 'content-type: application/json' -d "{\"type\":\"magiclink\",\"token_hash\":\"$H\"}" | jq -r .access_token
