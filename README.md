# Puschelz Desktop Client (V15)

Tray app that watches WoW `SavedVariables/Puschelz.lua`, syncs guild bank, calendar, and guild-order data to `/api/addon-sync`, and refreshes the companion bridge file from `/api/addon-bridge`.

## Features

- Tray app that runs in background
- Watches `Puschelz.lua` for changes
- Parses Lua SavedVariables and POSTs both payloads:
  - `type: "guildBank"`
  - `type: "calendar"`
  - `type: "guildOrders"`
- Uses API token from Puschelz profile page
- Writes `PuschelzBridge.lua` next to `Puschelz.lua` with craft-request bridge data and required-addon definitions
- Settings window for endpoint URL, token, and WoW path
- Status updates in tray and settings window

## Setup

1. Install dependencies:

```bash
npm install
```

2. Start app:

```bash
npm start
```

3. Open tray icon -> `Open Settings` and configure:

- `Website Base URL` (pre-filled default: `https://puschelz.de`)
- `API Token` (generated in Puschelz profile)
- `WoW Path` (WoW root folder or direct `Puschelz.lua` path)

4. Save config.

The app immediately starts watching and performs an initial sync.

## Development

```bash
npm test
npm run test:watch
npm run build
```

## SavedVariables resolution

The client resolves one file using this order:

1. Direct `.../Puschelz.lua` path if provided
2. `<wowPath>/_retail_/WTF/Account/*/SavedVariables/Puschelz.lua`
3. `<wowPath>/WTF/Account/*/SavedVariables/Puschelz.lua`

If multiple account matches exist, the most recently modified file is used.

## WoW path auto-detection

- On Windows, when `WoW Path` is empty, the app tries Blizzard WoW registry keys (`InstallPath`) and fills the first valid path automatically.
- If registry lookup fails, it falls back to common install locations under `C:\\Program Files` and `C:\\Program Files (x86)`.
