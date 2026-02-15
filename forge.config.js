const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const DEFAULT_LOCALES = ['en-US', 'de'];
const localesAllowList = (process.env.ELECTRON_LOCALES || DEFAULT_LOCALES.join(','))
  .split(',')
  .map((locale) => locale.trim())
  .filter(Boolean);

async function keepOnlyConfiguredLocales(buildPath) {
  const localesDir = path.join(buildPath, 'locales');

  if (!fs.existsSync(localesDir)) {
    return;
  }

  const localeFiles = await fsp.readdir(localesDir);
  const allowed = new Set(localesAllowList.map((locale) => `${locale}.pak`));
  const toDelete = localeFiles.filter((file) => file.endsWith('.pak') && !allowed.has(file));

  await Promise.all(toDelete.map((file) => fsp.unlink(path.join(localesDir, file))));
}

module.exports = {
  outDir: path.resolve(__dirname, 'release'),
  packagerConfig: {
    asar: true,
    icon: path.resolve(__dirname, 'assets', 'icon'),
    afterExtract: [keepOnlyConfiguredLocales],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'puschelz_client',
        authors: 'Puschelz',
        description: 'Puschelz desktop tray client for WoW addon sync',
        setupIcon: path.resolve(__dirname, 'assets', 'icon.ico'),
      },
    },
  ],
};
