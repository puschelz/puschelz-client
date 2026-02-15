const path = require('path');

module.exports = {
  outDir: path.resolve(__dirname, 'release'),
  packagerConfig: {
    asar: true,
    icon: path.resolve(__dirname, 'assets', 'icon'),
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
