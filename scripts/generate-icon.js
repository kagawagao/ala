#!/usr/bin/env node

/**
 * Simple script to copy logo.svg as a placeholder icon
 * 
 * For better quality, use ImageMagick or Inkscape:
 * convert -background none -density 1024 assets/logo.svg -resize 512x512 assets/icon.png
 * 
 * Or use an online converter like https://cloudconvert.com/svg-to-png
 */

const fs = require('fs');
const path = require('path');

const logoPath = path.join(__dirname, '..', 'assets', 'logo.svg');

// For now, just copy the SVG and rename it
// Electron and electron-builder can handle SVG icons on some platforms
const iconSvgPath = path.join(__dirname, '..', 'assets', 'icon.svg');
const iconPngPath = path.join(__dirname, '..', 'assets', 'icon.png');

if (fs.existsSync(logoPath)) {
  fs.copyFileSync(logoPath, iconSvgPath);
  console.log('✓ Created icon.svg from logo.svg');
  
  // Also create a symlink or copy as icon.png for compatibility
  try {
    fs.copyFileSync(logoPath, iconPngPath);
    console.log('✓ Created icon.png placeholder');
  } catch (e) {
    // Ignore error
  }
  
  console.log('\nℹ For best results, convert logo.svg to icon.png (512x512) using:');
  console.log('  - ImageMagick: convert -background none -density 1024 assets/logo.svg -resize 512x512 assets/icon.png');
  console.log('  - Inkscape: inkscape assets/logo.svg --export-type=png --export-filename=assets/icon.png --export-width=512');
  console.log('  - Online: https://cloudconvert.com/svg-to-png');
  console.log('\n  See assets/ICON.md for detailed instructions');
} else {
  console.error('✗ logo.svg not found in assets/');
  process.exit(1);
}
