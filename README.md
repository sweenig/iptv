# IPTV Web Player (Docker + Nginx)

Browser-based IPTV client that loads an M3U playlist and plays channels directly from source stream URLs.

- No server-side transcoding.
- Nginx only serves static files.
- Playback happens in the end-user browser (HLS.js, DASH.js, or native video).

## Run with Docker Compose

```bash
docker compose up -d --build
```

Open:

- http://localhost:8080

Stop:

```bash
docker compose down
```

## Run with Docker CLI

Build:

```bash
docker build -t iptv-web .
```

Run:

```bash
docker run --rm -p 8080:80 --name iptv-web iptv-web
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
- `app.js`: playlist parser, filters, player logic
- `nginx.conf`: static hosting config
- `Dockerfile`: container image
- `docker-compose.yml`: local runtime
