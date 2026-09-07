/* Blackout brand configuration.
   Set the domain once here and every watermark, link and label follows.
   Keeping it in one file also makes a future Free/Pro watermark switch
   straightforward. */
window.BLACKOUT_CONFIG = Object.assign({
  productName: 'Blackout',
  // Where the site lives. Used to build the links stamped into exported files,
  // so it must be absolute — a reader opens these from their own file system.
  siteUrl: 'https://dec3ptor.github.io/Redacted/',
  // Page that reverses a reversible file. Relative to siteUrl.
  unlockPath: 'unlock.html',
  // Shown under the mark. Falls back to siteUrl without the scheme.
  website: '',
  watermarkEnabled: true
}, window.BLACKOUT_CONFIG || {});
