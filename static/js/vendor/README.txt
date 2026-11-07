Scanning QR codes needs a small helper file in this folder.

WHY
Chrome can read QR codes by itself on Android, ChromeOS and macOS, because it uses the
operating system's barcode reader. Windows has no such thing, so Chrome and Edge on
Windows cannot do it, and nor can Safari or Firefox anywhere. One file fixes all of them.

WHAT TO DO  (about 30 seconds, needs internet once)
  1. Open this link:
        https://unpkg.com/jsqr@1.4.0/dist/jsQR.js
  2. Save the page  (Ctrl+S)  into this folder, named exactly:
        jsQR.js
  3. Restart listly.

You can delete this text file afterwards.

jsQR is open source under the Apache 2.0 licence: https://github.com/cozmo/jsQR