#!/usr/bin/env node

/**
 * Generate app icons from logo.svg using electron-icon-builder
 *
 * This script generates all required icon sizes for:
 * - macOS (.icns)
 * - Windows (.ico)
 * - Linux (.png)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const logoPath = path.join(__dirname, '..', 'assets', 'logo.svg');
const assetsDir = path.join(__dirname, '..', 'assets');

// Check if logo.svg exists
if (!fs.existsSync(logoPath)) {
  console.error('✗ logo.svg not found in assets/');
  process.exit(1);
}

console.log('Generating app icons from logo.svg...');

try {
  // First, convert SVG to high-res PNG (1024x1024) for icon generation
  // electron-icon-builder expects PNG input
  const tempPngPath = path.join(assetsDir, 'icon-temp-1024.png');

  // Try to use ImageMagick if available, otherwise use a simpler approach
  let conversionSuccess = false;

  try {
    execSync(
      `convert -background none -density 1024 "${logoPath}" -resize 1024x1024 "${tempPngPath}"`,
      { stdio: 'pipe' }
    );
    conversionSuccess = true;
    console.log('✓ Converted logo.svg to high-res PNG using ImageMagick');
  } catch (e) {
    // ImageMagick not available, try alternative
    console.log('⚠ ImageMagick not found, trying alternative method...');

    // Try using Inkscape if available
    try {
      execSync(
        `inkscape "${logoPath}" --export-type=png --export-filename="${tempPngPath}" --export-width=1024`,
        { stdio: 'pipe' }
      );
      conversionSuccess = true;
      console.log('✓ Converted logo.svg to high-res PNG using Inkscape');
    } catch (e2) {
      console.log('⚠ Inkscape not found either');
    }
  }

  if (conversionSuccess && fs.existsSync(tempPngPath)) {
    // Now use electron-icon-builder to generate all icon formats
    // Use npx for cross-platform compatibility
    try {
      execSync(
        `npx electron-icon-builder --input="${tempPngPath}" --output="${assetsDir}" --flatten`,
        { stdio: 'inherit', cwd: path.join(__dirname, '..') }
      );

      // Clean up temp file
      fs.unlinkSync(tempPngPath);

      console.log('\n✓ Successfully generated app icons:');
      console.log('  - macOS: icon.icns');
      console.log('  - Windows: icon.ico');
      console.log('  - Linux: icon.png (multiple sizes)');
      console.log('\n✓ All icon files ready for electron-builder');
    } catch (builderError) {
      console.error('✗ Error running electron-icon-builder:', builderError.message);
      console.error('Falling back to simple copy method...');
      // Don't throw, fall through to fallback
      if (fs.existsSync(tempPngPath)) {
        fs.unlinkSync(tempPngPath);
      }
      throw builderError;
    }
  } else {
    throw new Error('Could not convert SVG to PNG');
  }
} catch (error) {
  console.error('✗ Error generating icons:', error.message);
  console.error('\nFalling back to simple copy method...');

  // Fallback: just copy the SVG as placeholder
  const iconSvgPath = path.join(assetsDir, 'icon.svg');
  const iconPngPath = path.join(assetsDir, 'icon.png');

  fs.copyFileSync(logoPath, iconSvgPath);
  console.log('✓ Created icon.svg from logo.svg');

  try {
    fs.copyFileSync(logoPath, iconPngPath);
    console.log('✓ Created icon.png placeholder');
  } catch (e) {
    // Ignore error
  }

  console.log('\n⚠ Note: For production builds, install ImageMagick or Inkscape:');
  console.log('  - Ubuntu/Debian: sudo apt-get install imagemagick');
  console.log('  - macOS: brew install imagemagick');
  console.log('  - Windows: https://imagemagick.org/script/download.php');
}
