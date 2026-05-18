# What to collect from Plaud DevTools

This is a fallback path for environments where you cannot run an interactive
Playwright login (for example, a headless server). The exporter consumes a
small JSON file with the same data Plaud Web keeps in its `localStorage`.

## Safe warning

- Do **not** paste tokens into chat, Slack, GitHub issues, or screenshots.
- Keep the JSON locally; copy it to the server over SSH/SCP only.
- After the snapshot is in place, delete the source file from your `Downloads`
  folder.

## What to capture (Application tab)

1. Open `https://web.plaud.ai` in Chrome and sign in.
2. Open **DevTools → Application → Local Storage → https://web.plaud.ai**.
3. You need these keys (only some, depending on your account):

   | Key | Required | Notes |
   |-----|----------|-------|
   | `pld_tokenstr` | **yes** (or `tokenstr`) | User JWT |
   | `tokenstr` | alternative to `pld_tokenstr` | Legacy fallback |
   | `pld_<userId>:currentWorkspaceId` | recommended | Active workspace |
   | `pld_<userId>:workspaceList` | recommended | Workspace JWT + expiry |
   | `pld_<userId>:plaud_user_api_domain` | optional | Per-user API domain |
   | `plaud_user_api_domain` | optional | Global API domain |
   | `pld_<userId>_<workspaceId>:sort_by` | optional | List sort order |

   Where `<userId>` is the `sub` claim of your JWT. You do not need to decode
   the JWT manually — just look for keys that start with `pld_`.

4. Click each key's value cell to reveal the full string. Copy the value
   verbatim (including the surrounding quotes if Plaud stored a JSON string).

## What to capture (Network tab — optional)

Only needed if you want to verify the API behavior, not for `--import`.

- Filter to `XHR` and reload the page. Inspect one of:
  - `GET /file/simple/web?…` (request to the recordings list)
  - `GET /ai/query_note` (request to summary notes)
  - `GET /file/temp-url/{id}` (request to the audio URL)
- Confirm the request URL is on a `*.plaud.ai` host.
- **Never** export a HAR unredacted. If you must share one, edit it first to
  strip every `Authorization`, `Cookie`, and `Set-Cookie` value.

## Minimal JSON for `server:auth --import`

Create `plaud-session.json` locally:

```json
{
  "version": 1,
  "savedAt": "2026-05-17T12:34:56.000Z",
  "apiBase": "https://api.plaud.ai",
  "localStorage": {
    "pld_tokenstr": "PASTE_VALUE_FROM_DEVTOOLS",
    "pld_<userId>:currentWorkspaceId": "PASTE_VALUE",
    "pld_<userId>:workspaceList": "PASTE_JSON_STRING_VALUE",
    "pld_<userId>:plaud_user_api_domain": "PASTE_VALUE",
    "pld_<userId>_<workspaceId>:sort_by": "start_time"
  },
  "cookies": []
}
```

Notes:

- The values in `localStorage` are **strings**, just as Plaud stored them. If
  Plaud stored a JSON object as a string (e.g. `workspaceList`), keep it as
  the JSON string — do **not** parse it into an object.
- `cookies` is optional. The exporter does not rely on cookies for the API;
  they are stored only so a later Playwright refresh can keep them.

Then on the server:

```bash
npm run server:auth -- --import /path/to/plaud-session.json
```

The CLI validates the snapshot by calling `GET /file/simple/web?limit=1` and
reports the number of recordings visible. After validation, delete the source
file.

## HAR export and redaction (if you really need it)

1. DevTools → Network → right-click → **Save all as HAR with content**.
2. Open the file in any text editor.
3. Globally replace:
   - Every `Authorization` header value with `[REDACTED]`.
   - Every `Cookie` and `Set-Cookie` header value with `[REDACTED]`.
   - Anything that looks like `xxxxxx.yyyyyy.zzzzzz` (JWT) with `[REDACTED]`.
4. Save under a new name and share that file.
