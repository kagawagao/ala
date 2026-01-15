const { ipcRenderer } = require('electron');

// Configuration
const MAX_RENDERED_LOGS = 1000;  // Maximum number of logs to render for performance
const FILTERS_STORAGE_KEY = 'ala_saved_filters';  // LocalStorage key for saved filters

// State
let allLogs = [];
let filteredLogs = [];
let currentFiles = [];  // Changed from currentFile to support multiple files
let currentKeywords = '';  // Store current keywords for highlighting

// DOM Elements
const openFileBtn = document.getElementById('openFileBtn');
const fileName = document.getElementById('fileName');
const applyFiltersBtn = document.getElementById('applyFiltersBtn');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const saveFiltersBtn = document.getElementById('saveFiltersBtn');  // New button
const loadFiltersBtn = document.getElementById('loadFiltersBtn');  // New button
const analyzeBtn = document.getElementById('analyzeBtn');
const logViewer = document.getElementById('logViewer');
const aiResults = document.getElementById('aiResults');
const aiStatus = document.getElementById('aiStatus');

// Filter inputs
const startTimeInput = document.getElementById('startTime');
const endTimeInput = document.getElementById('endTime');
const keywordsInput = document.getElementById('keywords');
const logLevelSelect = document.getElementById('logLevel');
const tagFilterInput = document.getElementById('tagFilter');
const pidFilterInput = document.getElementById('pidFilter');
const aiPromptInput = document.getElementById('aiPrompt');

// Stats
const totalCount = document.getElementById('totalCount');
const filteredCount = document.getElementById('filteredCount');
const errorCount = document.getElementById('errorCount');
const warningCount = document.getElementById('warningCount');

// Tab switching
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.dataset.tab;
    
    // Update active tab button
    tabBtns.forEach(b => {
      b.classList.remove('active', 'text-accent-teal', 'border-accent-teal');
      b.classList.add('text-text-secondary', 'border-transparent');
    });
    btn.classList.add('active', 'text-accent-teal', 'border-accent-teal');
    btn.classList.remove('text-text-secondary', 'border-transparent');
    
    // Show corresponding content
    tabContents.forEach(content => {
      if (content.id === tabName + 'Tab') {
        content.classList.add('active');
        content.classList.remove('hidden');
      } else {
        content.classList.remove('active');
        content.classList.add('hidden');
      }
    });
  });
});

// Event Listeners
openFileBtn.addEventListener('click', async () => {
  const results = await ipcRenderer.invoke('open-log-files');
  if (results && results.length > 0) {
    currentFiles = results.map(r => r.filePath);
    
    // Display file names
    if (currentFiles.length === 1) {
      fileName.textContent = `📄 ${currentFiles[0].split(/[\\/]/).pop()}`;
    } else {
      fileName.textContent = `📄 ${currentFiles.length} files loaded`;
    }
    
    // Parse all log files
    showStatus(`Parsing ${currentFiles.length} log file(s)...`, 'info');
    allLogs = [];
    
    for (const result of results) {
      const logs = await ipcRenderer.invoke('parse-log', result.content);
      // Add file source to each log entry
      logs.forEach(log => {
        log.sourceFile = result.filePath.split(/[\\/]/).pop();
      });
      allLogs = allLogs.concat(logs);
    }
    
    filteredLogs = allLogs;
    
    updateStats();
    renderLogs(filteredLogs);
    
    // Check if AI is configured
    const aiConfigured = await ipcRenderer.invoke('check-ai-configured');
    analyzeBtn.disabled = !aiConfigured || filteredLogs.length === 0;
    
    if (!aiConfigured) {
      showStatus('AI not configured. Set OPENAI_API_KEY environment variable to enable AI analysis.', 'info');
    } else {
      showStatus(`Loaded ${allLogs.length} log lines from ${currentFiles.length} file(s). Ready for analysis.`, 'info');
    }
  }
});

applyFiltersBtn.addEventListener('click', async () => {
  if (allLogs.length === 0) {
    showStatus('No log file loaded', 'error');
    return;
  }

  const filters = {
    startTime: startTimeInput.value.trim(),
    endTime: endTimeInput.value.trim(),
    keywords: keywordsInput.value.trim(),
    level: logLevelSelect.value,
    tag: tagFilterInput.value.trim(),
    pid: pidFilterInput.value.trim()
  };

  // Store keywords for highlighting
  currentKeywords = filters.keywords;

  showStatus('Applying filters...', 'info');
  filteredLogs = await ipcRenderer.invoke('filter-logs', { logs: allLogs, filters });
  
  updateStats();
  renderLogs(filteredLogs);
  showStatus(`Filtered to ${filteredLogs.length} log lines`, 'info');
  
  // Update AI button
  const aiConfigured = await ipcRenderer.invoke('check-ai-configured');
  analyzeBtn.disabled = !aiConfigured || filteredLogs.length === 0;
});

clearFiltersBtn.addEventListener('click', () => {
  startTimeInput.value = '';
  endTimeInput.value = '';
  keywordsInput.value = '';
  logLevelSelect.value = 'ALL';
  tagFilterInput.value = '';
  pidFilterInput.value = '';
  currentKeywords = '';
  
  filteredLogs = allLogs;
  updateStats();
  renderLogs(filteredLogs);
  showStatus('Filters cleared', 'info');
});

// Save filters to localStorage
if (saveFiltersBtn) {
  saveFiltersBtn.addEventListener('click', () => {
    const filters = {
      startTime: startTimeInput.value.trim(),
      endTime: endTimeInput.value.trim(),
      keywords: keywordsInput.value.trim(),
      level: logLevelSelect.value,
      tag: tagFilterInput.value.trim(),
      pid: pidFilterInput.value.trim()
    };
    
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
    showStatus('Filters saved successfully!', 'info');
  });
}

// Load filters from localStorage
if (loadFiltersBtn) {
  loadFiltersBtn.addEventListener('click', () => {
    const savedFilters = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (savedFilters) {
      try {
        const filters = JSON.parse(savedFilters);
        startTimeInput.value = filters.startTime || '';
        endTimeInput.value = filters.endTime || '';
        keywordsInput.value = filters.keywords || '';
        logLevelSelect.value = filters.level || 'ALL';
        tagFilterInput.value = filters.tag || '';
        pidFilterInput.value = filters.pid || '';
        showStatus('Filters loaded successfully!', 'info');
      } catch (e) {
        showStatus('Failed to load saved filters', 'error');
      }
    } else {
      showStatus('No saved filters found', 'info');
    }
  });
}

analyzeBtn.addEventListener('click', async () => {
  if (filteredLogs.length === 0) {
    showStatus('No logs to analyze', 'error');
    return;
  }

  analyzeBtn.disabled = true;
  showStatus('Analyzing logs with AI... This may take a moment.', 'info');

  const prompt = aiPromptInput.value.trim();
  const result = await ipcRenderer.invoke('analyze-with-ai', { logs: filteredLogs, prompt });

  if (result.success) {
    showStatus('Analysis complete!', 'info');
    displayAIAnalysis(result.analysis);
    
    // Switch to analysis tab
    document.querySelector('[data-tab="analysis"]').click();
  } else {
    showStatus(`Analysis failed: ${result.error}`, 'error');
  }

  analyzeBtn.disabled = false;
});

// Functions
function updateStats() {
  totalCount.textContent = allLogs.length;
  filteredCount.textContent = filteredLogs.length;
  
  const errors = filteredLogs.filter(log => log.level === 'E').length;
  const warnings = filteredLogs.filter(log => log.level === 'W').length;
  
  errorCount.textContent = errors;
  warningCount.textContent = warnings;
}

function renderLogs(logs) {
  if (logs.length === 0) {
    logViewer.innerHTML = '<div class="flex items-center justify-center min-h-[300px] text-text-secondary"><p>No logs match the current filters.</p></div>';
    return;
  }

  // Limit rendering for performance
  const logsToRender = logs.slice(0, MAX_RENDERED_LOGS);
  
  let html = '';
  logsToRender.forEach(log => {
    const levelClass = `level-${log.level}`;
    const timestamp = log.timestamp ? `<span class="text-log-timestamp mr-2.5">${log.timestamp}</span>` : '';
    const level = `<span class="font-bold mr-2.5">${log.level}</span>`;
    const tag = log.tag !== 'Unknown' ? `<span class="text-accent-purple mr-2.5">[${log.tag}]</span>` : '';
    
    // Show source file if multiple files are loaded
    const sourceFile = currentFiles.length > 1 && log.sourceFile ? 
      `<span class="text-xs text-text-secondary mr-2.5">📄${log.sourceFile}</span>` : '';
    
    // Highlight keywords in message
    let message = escapeHtml(log.message);
    if (currentKeywords) {
      message = highlightKeywords(message, currentKeywords);
    }
    message = `<span>${message}</span>`;
    
    html += `<div class="log-line ${levelClass}">${timestamp}${level}${sourceFile}${tag}${message}</div>`;
  });
  
  if (logs.length > MAX_RENDERED_LOGS) {
    html += `<div class="flex items-center justify-center min-h-[100px] text-text-secondary"><p>Showing first ${MAX_RENDERED_LOGS} of ${logs.length} logs. Apply more filters to see more.</p></div>`;
  }
  
  logViewer.innerHTML = html;
}

// Highlight keywords in text
function highlightKeywords(text, keywords) {
  if (!keywords || !keywords.trim()) return text;
  
  try {
    // Try regex pattern first
    const pattern = new RegExp(`(${keywords})`, 'gi');
    return text.replace(pattern, '<mark class="bg-yellow-500/30 text-yellow-200 px-1 rounded">$1</mark>');
  } catch (e) {
    // Fallback to space-separated keywords
    const keywordList = keywords.toLowerCase().split(/\s+/).filter(k => k);
    let highlightedText = text;
    
    keywordList.forEach(keyword => {
      const regex = new RegExp(`(${escapeRegex(keyword)})`, 'gi');
      highlightedText = highlightedText.replace(regex, '<mark class="bg-yellow-500/30 text-yellow-200 px-1 rounded">$1</mark>');
    });
    
    return highlightedText;
  }
}

// Escape special regex characters
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function displayAIAnalysis(analysis) {
  // Security: First escape all HTML to prevent XSS, then apply safe formatting
  // All user/AI content is HTML-escaped before any transformations
  let formattedAnalysis = escapeHtml(analysis);
  
  // Convert headings
  formattedAnalysis = formattedAnalysis.replace(/^### (.*$)/gm, '<h4 class="text-accent-teal mt-4 mb-2.5">$1</h4>');
  formattedAnalysis = formattedAnalysis.replace(/^## (.*$)/gm, '<h4 class="text-accent-teal mt-4 mb-2.5">$1</h4>');
  
  // Convert bold
  formattedAnalysis = formattedAnalysis.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Convert bullet points
  formattedAnalysis = formattedAnalysis.replace(/^\- (.*$)/gm, '<li>$1</li>');
  formattedAnalysis = formattedAnalysis.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="ml-5 mb-2.5">$&</ul>');
  
  // Convert numbered lists
  formattedAnalysis = formattedAnalysis.replace(/^\d+\. (.*$)/gm, '<li>$1</li>');
  
  // Convert line breaks to paragraphs
  formattedAnalysis = formattedAnalysis.split('\n\n').map(para => {
    if (!para.trim() || para.startsWith('<')) return para;
    return `<p class="mb-2.5">${para}</p>`;
  }).join('\n');
  
  aiResults.innerHTML = `<div class="bg-dark-panel p-5 rounded border-l-4 border-accent-purple leading-7">${formattedAnalysis}</div>`;
}

function showStatus(message, type = 'info') {
  aiStatus.textContent = message;
  // Base classes
  aiStatus.className = 'mt-2.5 px-2 py-2 rounded text-xs';
  // Add type-specific classes
  if (type === 'info') {
    aiStatus.className += ' bg-blue-900/40 text-blue-300';
  } else if (type === 'error') {
    aiStatus.className += ' bg-red-900/40 text-red-300';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
(async () => {
  const aiConfigured = await ipcRenderer.invoke('check-ai-configured');
  if (!aiConfigured) {
    showStatus('AI features require OPENAI_API_KEY environment variable', 'info');
  }
  
  // Auto-load saved filters on startup
  const savedFilters = localStorage.getItem(FILTERS_STORAGE_KEY);
  if (savedFilters) {
    try {
      const filters = JSON.parse(savedFilters);
      startTimeInput.value = filters.startTime || '';
      endTimeInput.value = filters.endTime || '';
      keywordsInput.value = filters.keywords || '';
      logLevelSelect.value = filters.level || 'ALL';
      tagFilterInput.value = filters.tag || '';
      pidFilterInput.value = filters.pid || '';
      console.log('Loaded saved filters');
    } catch (e) {
      console.error('Failed to load saved filters:', e);
    }
  }
})();
