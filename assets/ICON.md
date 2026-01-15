# Icon Generation

The application uses `assets/logo.svg` as the source for the app icon.

## Converting SVG to PNG

To generate the icon.png from logo.svg, you can use one of the following methods:

### Method 1: Using ImageMagick
```bash
convert -background none -density 1024 assets/logo.svg -resize 512x512 assets/icon.png
```

### Method 2: Using Inkscape
```bash
inkscape assets/logo.svg --export-type=png --export-filename=assets/icon.png --export-width=512 --export-height=512
```

### Method 3: Online Conversion
Visit https://cloudconvert.com/svg-to-png and upload `assets/logo.svg`, then download as `assets/icon.png` (512x512 pixels).

## Icon Specifications

- **Size**: 512x512 pixels (recommended)
- **Format**: PNG with transparency
- **Location**: `assets/icon.png`
- **Used by**: Electron app window icon and electron-builder for platform-specific icons

The icon is automatically referenced in:
- `src/main.ts` - Window icon
- `package.json` (build section) - Platform-specific app icons (macOS, Windows, Linux)
