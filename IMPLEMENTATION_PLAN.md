# Implementation Plan for Preset Refactor

## Changes Needed:

### 1. Update FilterPreset Interface
Change from:
```typescript
{
  id, name, description, filters, keywordDescriptions, tagDescription, createdAt
}
```

To:
```typescript
{
  name, description,
  config: {
    tag: { text, description },
    keywords: [{ text, description }]
  }
}
```

### 2. Move Line-Break Mode to LogViewer
- Remove from ControlPanel
- Add as overlay button in LogViewer (top-right corner)

### 3. Add Preset Manager to Header Menu
- Add dropdown menu in Header
- Move "Manage Presets" from ControlPanel to Header

### 4. Add Ctrl+F Shortcut
- Add keyboard event listener in App
- Toggle control panel drawer with Ctrl+F

### 5. Update FilterPresetManager
- Remove currentFilters dependency
- Allow user to input all preset data manually
- Update save/load logic for new structure

### 6. Update All References
- App.tsx: Update preset handling
- ControlPanel.tsx: Remove preset management
- LogViewer.tsx: Add line-break mode overlay
- Header.tsx: Add preset menu
