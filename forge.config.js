const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const DEFAULT_LOCALES = ['en-US', 'de'];
const localesAllowList = (process.env.ELECTRON_LOCALES || DEFAULT_LOCALES.join(','))
  .split(',')
  .map((locale) => locale.trim())
  .filter(Boolean);

function keepOnlyConfiguredLocales(buildPath, _electronVersion, _platform, _arch, done) {
  const localesDir = path.join(buildPath, 'locales');

  if (!fs.existsSync(localesDir)) {
    done();
    return;
  }

  fsp
    .readdir(localesDir)
    .then((localeFiles) => {
      const allowed = new Set(localesAllowList.map((locale) => `${locale}.pak`));
      const toDelete = localeFiles.filter((file) => file.endsWith('.pak') && !allowed.has(file));
      return Promise.all(toDelete.map((file) => fsp.unlink(path.join(localesDir, file))));
    })
    .then(() => done())
    .catch((error) => done(error));
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
