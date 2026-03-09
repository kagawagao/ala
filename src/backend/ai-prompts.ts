/**
 * AI Analysis Prompts for different scenarios
 */

export interface AIPromptPreset {
  id: string;
  name: string;
  nameKey: string; // i18n key
  description: string;
  descriptionKey: string; // i18n key
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

export const AI_PROMPT_PRESETS: AIPromptPreset[] = [
  {
    id: 'general',
    name: 'General Analysis',
    nameKey: 'aiPresetGeneral',
    description: 'Comprehensive log analysis covering errors, warnings, and patterns',
    descriptionKey: 'aiPresetGeneralDesc',
    systemPrompt: `You are an expert Android log analyzer. Analyze the provided Android logs and provide insights about:
1. Errors and warnings
2. Potential issues or crashes
3. Performance concerns
4. Notable patterns or anomalies
5. Recommendations for debugging

Be concise and focus on actionable insights.`,
    userPrompt: 'Analyze these Android logs and provide insights.',
    maxTokens: 1000,
    temperature: 0.7,
  },
  {
    id: 'crash',
    name: 'Crash Analysis',
    nameKey: 'aiPresetCrash',
    description: 'Focus on crash diagnostics, stack traces, and root cause analysis',
    descriptionKey: 'aiPresetCrashDesc',
    systemPrompt: `You are an expert Android crash analyzer. Focus on:
1. Identifying crash causes and stack traces
2. Root cause analysis of fatal errors
3. Related errors that may have led to the crash
4. Memory issues (OOM, leaks)
5. Thread/concurrency problems
6. Specific recommendations to fix the crash

Provide detailed analysis with line references where possible.`,
    userPrompt: 'Analyze these logs to identify crashes and their root causes.',
    maxTokens: 1500,
    temperature: 0.5,
  },
  {
    id: 'performance',
    name: 'Performance Analysis',
    nameKey: 'aiPresetPerformance',
    description: 'Analyze performance issues, lag, memory usage, and optimization opportunities',
    descriptionKey: 'aiPresetPerformanceDesc',
    systemPrompt: `You are an Android performance expert. Analyze logs for:
1. Performance bottlenecks and slow operations
2. Memory usage patterns and potential leaks
3. UI thread blocking and ANR (Application Not Responding)
4. Resource usage (CPU, GPU, Network)
5. Database and I/O performance
6. Frame drops and rendering issues
7. Optimization recommendations

Focus on measurable metrics and specific improvements.`,
    userPrompt: 'Analyze these logs for performance issues and optimization opportunities.',
    maxTokens: 1200,
    temperature: 0.6,
  },
  {
    id: 'security',
    name: 'Security Analysis',
    nameKey: 'aiPresetSecurity',
    description: 'Identify security vulnerabilities, permission issues, and potential exploits',
    descriptionKey: 'aiPresetSecurityDesc',
    systemPrompt: `You are a mobile security expert. Examine logs for:
1. Security vulnerabilities and warnings
2. Permission issues and unauthorized access attempts
3. Data leaks or exposure of sensitive information
4. Authentication and authorization problems
5. Network security issues (TLS, certificates)
6. Potential exploit attempts or suspicious behavior
7. Security best practices violations

Provide severity ratings and mitigation strategies.`,
    userPrompt: 'Analyze these logs for security vulnerabilities and risks.',
    maxTokens: 1200,
    temperature: 0.5,
  },
  {
    id: 'network',
    name: 'Network Analysis',
    nameKey: 'aiPresetNetwork',
    description: 'Focus on network requests, API calls, connectivity, and data transfer issues',
    descriptionKey: 'aiPresetNetworkDesc',
    systemPrompt: `You are an Android networking specialist. Analyze logs for:
1. Network request failures and timeouts
2. API errors and HTTP status codes
3. Connectivity issues (WiFi, mobile data)
4. SSL/TLS certificate problems
5. Data transfer performance
6. Network protocol issues
7. Retry patterns and error handling

Identify patterns and suggest improvements.`,
    userPrompt: 'Analyze these logs for network-related issues.',
    maxTokens: 1000,
    temperature: 0.6,
  },
  {
    id: 'lifecycle',
    name: 'App Lifecycle Analysis',
    nameKey: 'aiPresetLifecycle',
    description: 'Analyze Activity/Fragment lifecycle, state management, and navigation issues',
    descriptionKey: 'aiPresetLifecycleDesc',
    systemPrompt: `You are an Android lifecycle expert. Focus on:
1. Activity and Fragment lifecycle events
2. State management issues
3. Configuration changes (rotation, etc.)
4. Navigation problems
5. Memory leaks in lifecycle components
6. Incorrect lifecycle handling
7. Background/foreground transitions

Explain lifecycle-related bugs and best practices.`,
    userPrompt: 'Analyze these logs for app lifecycle and state management issues.',
    maxTokens: 1000,
    temperature: 0.6,
  },
  {
    id: 'ui',
    name: 'UI/UX Analysis',
    nameKey: 'aiPresetUI',
    description: 'Focus on UI rendering, layout issues, touch events, and user interaction problems',
    descriptionKey: 'aiPresetUIDesc',
    systemPrompt: `You are a UI/UX specialist for Android. Analyze logs for:
1. UI rendering errors and inflation issues
2. Layout problems and constraint violations
3. Touch event handling and gesture issues
4. RecyclerView/ListView problems
5. View binding and data binding errors
6. Animation and transition issues
7. Accessibility problems

Provide UI-specific recommendations.`,
    userPrompt: 'Analyze these logs for UI/UX issues.',
    maxTokens: 1000,
    temperature: 0.6,
  },
];

/**
 * Get a preset by ID
 */
export function getPresetById(id: string): AIPromptPreset | undefined {
  return AI_PROMPT_PRESETS.find((p) => p.id === id);
}

/**
 * Get all preset IDs and names for UI selection
 */
export function getPresetList(): Array<{ id: string; name: string; nameKey: string; description: string; descriptionKey: string }> {
  return AI_PROMPT_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    nameKey: p.nameKey,
    description: p.description,
    descriptionKey: p.descriptionKey,
  }));
}
