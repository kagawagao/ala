const { ipcRenderer } = require('electron');

// Configuration
const MAX_RENDERED_LOGS = 1000;  // Maximum number of logs to render for performance

// State
let allLogs = [];
let filteredLogs = [];
let currentFile = null;

// DOM Elements
const openFileBtn = document.getElementById('openFileBtn');
const fileName = document.getElementById('fileName');
const applyFiltersBtn = document.getElementById('applyFiltersBtn');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
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
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Show corresponding content
    tabContents.forEach(content => {
      if (content.id === tabName + 'Tab') {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  });
});

// Event Listeners
openFileBtn.addEventListener('click', async () => {
  const result = await ipcRenderer.invoke('open-log-file');
  if (result) {
    currentFile = result.filePath;
    fileName.textContent = `📄 ${currentFile.split(/[\\/]/).pop()}`;
    
    // Parse the log file
    showStatus('Parsing log file...', 'info');
    allLogs = await ipcRenderer.invoke('parse-log', result.content);
    filteredLogs = allLogs;
    
    updateStats();
    renderLogs(filteredLogs);
    
    // Check if AI is configured
    const aiConfigured = await ipcRenderer.invoke('check-ai-configured');
    analyzeBtn.disabled = !aiConfigured || filteredLogs.length === 0;
    
    if (!aiConfigured) {
      showStatus('AI not configured. Set OPENAI_API_KEY environment variable to enable AI analysis.', 'info');
    } else {
      showStatus(`Loaded ${allLogs.length} log lines. Ready for analysis.`, 'info');
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
  
  filteredLogs = allLogs;
  updateStats();
  renderLogs(filteredLogs);
  showStatus('Filters cleared', 'info');
});

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
    logViewer.innerHTML = '<div class="empty-state"><p>No logs match the current filters.</p></div>';
    return;
  }

  // Limit rendering for performance
  const logsToRender = logs.slice(0, MAX_RENDERED_LOGS);
  
  let html = '';
  logsToRender.forEach(log => {
    const levelClass = `level-${log.level}`;
    const timestamp = log.timestamp ? `<span class="log-timestamp">${log.timestamp}</span>` : '';
    const level = `<span class="log-level">${log.level}</span>`;
    const tag = log.tag !== 'Unknown' ? `<span class="log-tag">[${log.tag}]</span>` : '';
    const message = `<span class="log-message">${escapeHtml(log.message)}</span>`;
    
    html += `<div class="log-line ${levelClass}">${timestamp}${level}${tag}${message}</div>`;
  });
  
  if (logs.length > MAX_RENDERED_LOGS) {
    html += `<div class="empty-state"><p>Showing first ${MAX_RENDERED_LOGS} of ${logs.length} logs. Apply more filters to see more.</p></div>`;
  }
  
  logViewer.innerHTML = html;
}

function displayAIAnalysis(analysis) {
  // Security: First escape all HTML to prevent XSS, then apply safe formatting
  // All user/AI content is HTML-escaped before any transformations
  let formattedAnalysis = escapeHtml(analysis);
  
  // Convert headings
  formattedAnalysis = formattedAnalysis.replace(/^### (.*$)/gm, '<h4>$1</h4>');
  formattedAnalysis = formattedAnalysis.replace(/^## (.*$)/gm, '<h4>$1</h4>');
  
  // Convert bold
  formattedAnalysis = formattedAnalysis.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Convert bullet points
  formattedAnalysis = formattedAnalysis.replace(/^\- (.*$)/gm, '<li>$1</li>');
  formattedAnalysis = formattedAnalysis.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  
  // Convert numbered lists
  formattedAnalysis = formattedAnalysis.replace(/^\d+\. (.*$)/gm, '<li>$1</li>');
  
  // Convert line breaks to paragraphs
  formattedAnalysis = formattedAnalysis.split('\n\n').map(para => {
    if (!para.trim() || para.startsWith('<')) return para;
    return `<p>${para}</p>`;
  }).join('\n');
  
  aiResults.innerHTML = `<div class="ai-analysis-content">${formattedAnalysis}</div>`;
}

function showStatus(message, type = 'info') {
  aiStatus.textContent = message;
  aiStatus.className = `ai-status ${type}`;
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
})();
