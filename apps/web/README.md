# apps/web

Next.js (App Router) app: the Node backend (route handlers under `app/api`) and,
from Session 8, the MapLibre UI. Shared spatial logic lives in `packages/geo-core`,
which `predev`/`prebuild` compile before Next starts.

```bash
npm run dev -w @urbanheat/web      # http://localhost:3000
npm run typecheck -w @urbanheat/web
npm test -w @urbanheat/web
```

Environment comes from the repo-root `.env` (loaded in `next.config.ts`).
