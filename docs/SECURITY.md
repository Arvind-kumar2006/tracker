# Security and local configuration

Copy `server/.env.example` to `server/.env` for local setup. Keep real credentials only in the
ignored `.env` file or in your shell environment.

- `OPENROUTER_API_KEY` is server-only and is never needed by the mobile bundle.
- `GOOGLE_SERVICE_ACCOUNT_JSON` may be a path to a local service-account JSON file; leave it blank
  unless Sheets sync is needed.
- Use the local MongoDB URI for development, or provide your own Atlas URI in `server/.env`.
- If a credential has ever been committed or shared, revoke and rotate it before reuse.
