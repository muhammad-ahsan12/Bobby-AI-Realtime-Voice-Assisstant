# Bobby local setup

This guide covers a Windows development setup. The project root is `D:\bobby`; use a separate
PowerShell window for the backend, agent, and web app.

## Requirements

- Windows 10 or 11, Python 3.10+ (Python 3.11 is used in the current development environment).
- Node.js 20+ and npm; Chrome.
- A LiveKit project and a Google AI API key.
- Gmail OAuth credentials and/or a GitHub fine-grained token only if those MCPs are enabled.

## Install

Clone the repository (replace the placeholder with the repository URL), create a virtual
environment, install Python packages, and install web dependencies:

```powershell
git clone <repository-url> D:\bobby
Set-Location D:\bobby
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Set-Location D:\bobby\apps\web
npm ci
```

Copy the root template and populate it locally:

```powershell
Set-Location D:\bobby
Copy-Item .env.example .env
```

Do not commit `.env`. The web app's Vite configuration reads the root environment directory;
`VITE_API_URL` is optional and defaults to `http://127.0.0.1:8000`. See the root README for the
environment variable table. If you have an older ignored `apps/web/.env.local`, copy any desired
`VITE_API_URL` setting into the root `.env`; Vite no longer loads the nested env directory.

## Gmail OAuth setup

The agent starts `@gongrzhe/server-gmail-autoauth-mcp` with `npx.cmd`. Before enabling Gmail:

1. Create a Google Cloud project, enable the Gmail API, and configure an OAuth consent screen.
2. Create and download an OAuth client credential JSON file. For a web OAuth client, register
   `http://localhost:3000/oauth2callback` as an authorized redirect URI. Add your Google account
   as a test user while the consent screen is in testing mode.
3. Keep the downloaded file outside the repository at
   `%USERPROFILE%\.gmail-mcp\gcp-oauth.keys.json`.
4. Run this one-time authorization from PowerShell:

   ```powershell
   npx -y @gongrzhe/server-gmail-autoauth-mcp auth
   ```

The package opens the browser for consent and stores its generated
`%USERPROFILE%\.gmail-mcp\credentials.json` outside the repository. Never copy either file into
the project or print its contents. Stop the web dev server if it is occupying localhost port 3000
during OAuth.

The Bobby client exposes only `search_emails`, `read_email`, `draft_email`, `send_email`,
`modify_email`, and `list_email_labels`. The agent instructions require confirmation before
sending email. Destructive delete, filter, and batch-delete tools are not in the client allowlist.

## GitHub MCP setup

Create a fine-grained personal access token limited to the repositories Bobby needs. Grant only
the read permissions required for repositories, issues, and pull requests initially, and place the
token in the root `.env` as `GITHUB_PERSONAL_ACCESS_TOKEN`. The GitHub MCP client requests
read-only operation and the `repos,issues,pull_requests` toolsets. Do not enable write permission
unless the code's policy and your requirements are deliberately changed.

## Load the Chrome extension

1. In Chrome, open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose `D:\bobby\apps\chrome-extension`.
3. Open and pin the extension popup.
4. Grant all-sites permission only if page reading/control on arbitrary sites is wanted.
   Whole-Chrome tab access is another optional permission and can be revoked in the popup.

The extension connects to `ws://127.0.0.1:8765/browser` when the agent session starts. It does not
use DevTools, remote debugging, or a separate Chrome profile.

## Start the services

Backend, from `apps/backend`:

```powershell
Set-Location D:\bobby\apps\backend
..\..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Agent, from the project root:

```powershell
Set-Location D:\bobby
.\.venv\Scripts\python.exe .\apps\agent\agent.py dev
```

Web UI, from `apps/web`:

```powershell
Set-Location D:\bobby\apps\web
npm run dev
```

Open `http://localhost:3000` and connect. Check backend health at
`http://127.0.0.1:8000/api/health`. To preview the dashboard without LiveKit credentials, open
`http://localhost:3000/?demo=1`; demo events are scripted locally and do not call the agent or
backend. The dashboard remains in English, while voice responses follow the detected speech
language. Camera and screen sharing are disabled until enabled in an active session and require
browser permission.

## Troubleshooting

- **Gmail OAuth port conflict:** stop Vite or another service on port 3000, then retry the auth
  command.
- **Google OAuth `access_denied`:** add the signing-in account to the OAuth consent screen's test
  users if the app remains in testing mode.
- **Slow MCP startup:** desktop/Gmail/GitHub MCP startup runs concurrently. Read agent logs for
  `"<toolset> toolset ready in Xs"` and the total `MCP toolsets ready ... in Xs` duration.
  Desktop downloads its pinned package and Windows runtime on first use.
- **Chrome tools report disconnected:** make sure the agent and a voice session are running, check
  the extension popup, and verify Chrome has not revoked its site permission.
- **Windows action is blocked:** UIPI can prevent input to an elevated window from a non-elevated
  Bobby process. Do not run Bobby as Administrator to bypass that boundary.
- **Token endpoint fails:** verify `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in
  the root `.env`.

## Tests

From the project root:

```powershell
.\.venv\Scripts\python.exe -m compileall apps mcp_servers
.\.venv\Scripts\python.exe -m pytest
```

For frontend validation, run `npm run lint` and `npm run build` in `apps/web`.

## Regenerate the project guide PDF

The generated PDF is based on `docs/BOBBY_AI_PROJECT_GUIDE.md`. ReportLab is only needed for
document generation and is not an application runtime dependency:

```powershell
Set-Location D:\bobby
.\.venv\Scripts\python.exe -m pip install reportlab
.\.venv\Scripts\python.exe docs\build_project_guide.py
```
