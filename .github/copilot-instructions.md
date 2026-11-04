# Copilot instructions

## Project structure

- This is a Spanish-language church app with a static, multi-page frontend and a separate Express API.
- `index.html` is the sign-in/registration page; `Inicio.html` is the authenticated home page. `Registrarme.html` redirects to registration.
- `frontend/` contains the app modules. Each module has its own HTML page, stylesheet, and JavaScript controller (for example, `frontend/Eventos/`). Shared authenticated navigation and shell behavior live in `frontend/module-shell.js` and `frontend/module-shell.css`.
- Root-level `app.js` provides shared API request helpers. `api-config.js` configures the API base URL. Root-level `pwa.js`, `pwa.css`, `service-worker.js`, and `manifest.webmanifest` support installation as a PWA.
- `backend/` contains the CommonJS Express API (`server.js`), its `package.json` and lockfile, `.env.example`, and the `cantos-getse.json` seed data.
- `README.md` documents local setup, application behavior, and deployment.

## Coding conventions

- Preserve the existing plain HTML, CSS, and JavaScript architecture; there is no frontend framework or bundler. Keep module-specific UI and behavior in that module's files and shared authentication/navigation in the existing shared files.
- Follow the existing naming and casing of module files, and match nearby formatting: semicolons, single-quoted JavaScript strings, and four-space indentation in backend code.
- Keep user-facing text in Spanish and consistent with the existing UI. Reuse the shared `MiIglesia` API helpers and existing API conventions rather than introducing a second request or authentication layer.
- Do not commit `.env` files, credentials, connection strings, or other secrets. Use `backend/.env.example` as the template for local configuration.

## Build, run, and test

- There is no frontend build step and no repository test framework or test script. Do not add a build or test tool unless the task requires it.
- The backend requires Node.js 20 or later and PostgreSQL. From `backend/`, install dependencies and start the API:

  ```sh
  npm install
  npm start
  ```

- Before starting locally, copy `backend/.env.example` to `backend/.env` and set at least `DATABASE_URL` and a long, random `JWT_SECRET`. The API listens on port 3000 by default.
- Serve the repository root with a static web server (the README uses Live Server). For local development, set `api-config.js` to `http://localhost:3000`; restore the deployed API URL before publishing.
- Since there is no automated test suite, use targeted checks for changes, such as `node --check` on modified JavaScript files, and verify frontend changes in a browser with the API configured.
