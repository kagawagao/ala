// Predefined highlight colors for user selection
export interface HighlightColor {
  id: string;
  name: string;
  light: {
    background: string;
    text: string;
  };
  dark: {
    background: string;
    text: string;
  };
}

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  {
    id: 'yellow',
    name: 'Yellow',
    light: {
      background: 'rgba(255, 215, 0, 0.5)', // Gold
      text: '#8b6914', // Dark brown/olive
    },
    dark: {
      background: 'rgba(234, 179, 8, 0.3)', // Semi-transparent amber
      text: '#fef08a', // Light yellow
    },
  },
  {
    id: 'red',
    name: 'Red',
    light: {
      background: 'rgba(239, 68, 68, 0.25)', // Light red
      text: '#991b1b', // Dark red
    },
    dark: {
      background: 'rgba(239, 68, 68, 0.3)', // Semi-transparent red
      text: '#fca5a5', // Light red
    },
  },
  {
    id: 'green',
    name: 'Green',
    light: {
      background: 'rgba(34, 197, 94, 0.25)', // Light green
      text: '#14532d', // Dark green
    },
    dark: {
      background: 'rgba(34, 197, 94, 0.3)', // Semi-transparent green
      text: '#86efac', // Light green
    },
  },
  {
    id: 'blue',
    name: 'Blue',
    light: {
      background: 'rgba(59, 130, 246, 0.25)', // Light blue
      text: '#1e3a8a', // Dark blue
    },
    dark: {
      background: 'rgba(59, 130, 246, 0.3)', // Semi-transparent blue
      text: '#93c5fd', // Light blue
    },
  },
  {
    id: 'purple',
    name: 'Purple',
    light: {
      background: 'rgba(168, 85, 247, 0.25)', // Light purple
      text: '#581c87', // Dark purple
    },
    dark: {
      background: 'rgba(168, 85, 247, 0.3)', // Semi-transparent purple
      text: '#d8b4fe', // Light purple
    },
  },
  {
    id: 'orange',
    name: 'Orange',
    light: {
      background: 'rgba(249, 115, 22, 0.25)', // Light orange
      text: '#7c2d12', // Dark orange
    },
    dark: {
      background: 'rgba(249, 115, 22, 0.3)', // Semi-transparent orange
      text: '#fdba74', // Light orange
    },
  },
  {
    id: 'pink',
    name: 'Pink',
    light: {
      background: 'rgba(236, 72, 153, 0.25)', // Light pink
      text: '#831843', // Dark pink
    },
    dark: {
      background: 'rgba(236, 72, 153, 0.3)', // Semi-transparent pink
      text: '#f9a8d4', // Light pink
    },
  },
  {
    id: 'cyan',
    name: 'Cyan',
    light: {
      background: 'rgba(6, 182, 212, 0.25)', // Light cyan
      text: '#164e63', // Dark cyan
    },
    dark: {
      background: 'rgba(6, 182, 212, 0.3)', // Semi-transparent cyan
      text: '#67e8f9', // Light cyan
    },
  },
];

export function getHighlightColorById(
  colorId: string,
  themeMode: 'light' | 'dark'
): { background: string; text: string } {
  const color = HIGHLIGHT_COLORS.find((c) => c.id === colorId);
  if (!color) {
    // Default to yellow if color not found
    return HIGHLIGHT_COLORS[0][themeMode];
  }
  return color[themeMode];
}
