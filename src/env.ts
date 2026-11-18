export interface Env {
  /** stamp counts: key `stamp:<id>` → {"good":n,"odd":n}; per-day dedupe/caps under `seen:` / `cap:` */
  STAMPS: KVNamespace;
  /** every MCP request, keyed by hashed IP */
  RL_READ: RateLimit;
  /** stamp + leave_souvenir, keyed by hashed IP */
  RL_WRITE: RateLimit;
  /** leave_souvenir burst limit across all callers (key "global") */
  RL_SOUVENIR: RateLimit;
  /** Daily souvenir caps (integers as strings, from wrangler vars). Defaults 3 per caller, 50 overall. */
  SOUVENIR_PER_CALLER_DAILY_CAP?: string;
  SOUVENIR_GLOBAL_DAILY_CAP?: string;

  /** Root secret. Separate keys for game tokens and caller ids are derived from it. Required. */
  GAME_SECRET?: string;

  /** GitHub App that opens souvenir issues. All four needed; otherwise leave_souvenir says so. */
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string; // PEM, PKCS#1 ("RSA PRIVATE KEY", as GitHub hands it out) or PKCS#8
  GITHUB_INSTALLATION_ID?: string;
  SOUVENIR_REPO?: string; // "<owner>/recess-inbox": the PRIVATE inbox repo
  /** "1" → when the App isn't configured, return the would-be issue payload (local dev only). */
  SOUVENIR_DRY_RUN?: string;
}
