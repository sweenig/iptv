# IPTV Web Player (Docker)

Browser-based IPTV client that loads an M3U playlist and plays channels directly from source stream URLs.

- No server-side transcoding.
- Nginx serves the web app.
- Playback happens in the end-user browser (HLS.js, DASH.js, or native video).
- Favorites are persisted server-side and shared globally across sessions, browsers, and devices.
- Favorites can be drag-reordered and the order is persisted globally.
- Full settings can be exported/imported as JSON from the settings menu, including favorites, hidden channels, playlist URL, and sidebar width.
- Failed channels can be hidden (blacklisted) globally from an in-player prompt.
- Channel panel width can be resized with the visible splitter handle.
- Hidden channels can be individually restored from a settings list with slash-eye controls.

## Services

- `iptv-web` (Nginx): serves UI and proxies `/api/*`.
- `favorites-api` (Node.js): stores favorites in a Docker volume.

## Run with Docker Compose

```bash
docker compose up -d --build
```

Open:

- http://localhost:8085

Stop:

```bash
docker compose down
```

To reset global favorites:

```bash
docker compose down -v
```

## Default Playlist

The app starts with:

- https://iptv-org.github.io/iptv/index.m3u

You can replace it in the UI with country/category playlists from iptv-org.

## Important Limitations

Some channels may not play in browser even if they work in VLC.

Common reasons:

- CORS blocked by channel origin.
- HTTPS page trying to load HTTP stream (mixed content).
- Browser codec support mismatch.
- Geo/IP restrictions.
- Stream endpoint is dead/intermittent.

## Project Files

- `index.html`: UI shell
- `styles.css`: responsive styling
- `app.js`: playlist parsing, filtering, player logic, favorites UI
- `nginx.conf`: static hosting and API proxy
- `Dockerfile`: `iptv-web` image
- `docker-compose.yml`: local runtime and persistent volume
- `api/server.js`: favorites API
- `api/Dockerfile`: `favorites-api` image
