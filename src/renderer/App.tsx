import React, { useState, useEffect, useRef } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import { useTranslation } from 'react-i18next';
import { LogEntry, LogFilters, LogStatistics } from './types';
import Header from './components/Header';
import ControlPanel from './components/ControlPanel';
import LogViewer from './components/LogViewer';
import FilterPresetManager, { FilterPreset } from './components/FilterPresetManager';

// Constants
const KEYWORD_SEPARATOR = '|';

const App: React.FC = () => {
  const { i18n } = useTranslation();
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
  const [currentFiles, setCurrentFiles] = useState<string[]>([]);
  const [rawFileContents, setRawFileContents] = useState<{ filePath: string; content: string }[]>([]);
  const [statistics, setStatistics] = useState<LogStatistics | null>(null);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [filters, setFilters] = useState<LogFilters>({
    startTime: '',
    endTime: '',
    keywords: '',
    level: 'ALL',
    tag: '',
    pid: ''
  });
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [statusType, setStatusType] = useState<'info' | 'error'>('info');
  const [aiConfigured, setAiConfigured] = useState<boolean>(false);
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'logs' | 'ai'>('logs');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);
  const [presetManagerVisible, setPresetManagerVisible] = useState<boolean>(false);
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark');
  const [lineBreakMode, setLineBreakMode] = useState<'wrap' | 'nowrap'>('wrap');
  const [activePresetDescriptions, setActivePresetDescriptions] = useState<{
    keywordDescriptions: { keyword: string; description: string }[];
    tagDescription: string;
  }>({ keywordDescriptions: [], tagDescription: '' });
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Load language preference from localStorage
    const savedLanguage = localStorage.getItem('ala_language');
    if (savedLanguage) {
      i18n.changeLanguage(savedLanguage);
    }

    // Load theme preference from localStorage
    const savedTheme = localStorage.getItem('ala_theme') as 'dark' | 'light' | null;
    if (savedTheme) {
      setThemeMode(savedTheme);
    }

    // Check AI configuration on mount
    const checkAI = async () => {
      const configured = await window.electronAPI.checkAIConfigured();
      setAiConfigured(configured);
      if (!configured) {
        showStatus('AI features require OPENAI_API_KEY environment variable', 'info');
      }
    };
    checkAI();

    // Load saved filters from localStorage (excluding time and PID fields)
    const savedFilters = localStorage.getItem('ala_saved_filters');
    if (savedFilters) {
      try {
        const parsed = JSON.parse(savedFilters);
        // Don't restore time and PID fields
        setFilters({
          ...parsed,
          startTime: '',
          endTime: '',
          pid: ''
        });
      } catch (e) {
        console.error('Failed to load saved filters:', e);
      }
    }

    // Add Ctrl+Shift+F keyboard shortcut to toggle drawer
    // Note: Uses Shift modifier to avoid conflict with browser's native Ctrl+F (find)
    // May still conflict with some browser extensions, but this is acceptable for a desktop app
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setDrawerOpen(prev => !prev);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);

    // Initialize Web Worker for filtering
    const workerCode = `
      self.onmessage = function(e) {
        const { logs, filters } = e.data;
        
        try {
          const filtered = logs.filter((log) => {
            if (filters.startTime && log.timestamp < filters.startTime) return false;
            if (filters.endTime && log.timestamp > filters.endTime) return false;

            if (filters.keywords && filters.keywords.trim()) {
              try {
                const regex = new RegExp(filters.keywords, 'i');
                if (!regex.test(log.message)) return false;
              } catch (e) {
                const keywords = filters.keywords.toLowerCase().split(/\\s+/).filter(k => k);
                const message = log.message.toLowerCase();
                const hasMatch = keywords.some(keyword => message.includes(keyword));
                if (!hasMatch) return false;
              }
            }

            if (filters.level && filters.level !== 'ALL' && log.level !== filters.level) return false;

            if (filters.tag && filters.tag.trim()) {
              try {
                const tagRegex = new RegExp(filters.tag, 'i');
                if (!tagRegex.test(log.tag)) return false;
              } catch (e) {
                // Fallback to case-insensitive contains search
                if (!log.tag.toLowerCase().includes(filters.tag.toLowerCase())) return false;
              }
            }

            if (filters.pid && filters.pid.trim() && log.pid !== filters.pid) return false;

            return true;
          });
          
          self.postMessage({ success: true, filtered });
        } catch (error) {
          self.postMessage({ success: false, error: error.message });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    workerRef.current = new Worker(URL.createObjectURL(blob));

    workerRef.current.onmessage = (e) => {
      const { success, filtered, error } = e.data;
      if (success) {
        setFilteredLogs(filtered);
        setIsSearching(false);
        showStatus(`Filtered to ${filtered.length} log lines`, 'info');
      } else {
        setIsSearching(false);
        showStatus(`Filter error: ${error}`, 'error');
      }
    };

    return () => {
      // Cleanup worker and keyboard listener on unmount
      window.removeEventListener('keydown', handleKeyDown);
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  useEffect(() => {
    // Update statistics whenever filteredLogs changes
    if (filteredLogs.length > 0) {
      updateStatistics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredLogs]);

  const showStatus = (message: string, type: 'info' | 'error' = 'info') => {
    setStatusMessage(message);
    setStatusType(type);
    setTimeout(() => setStatusMessage(''), 5000);
  };

  const handleOpenFiles = async () => {
    const results = await window.electronAPI.openLogFiles();
    if (results && results.length > 0) {
      const fileNames = results.map(r => r.filePath);
      setCurrentFiles(fileNames);
      setRawFileContents(results);
      
      // Clear existing logs
      setAllLogs([]);
      setFilteredLogs([]);
      
      showStatus(`Loaded ${results.length} file(s). Click "Search" to parse and filter logs.`, 'info');
    }
  };

  const handleSearch = async () => {
    if (rawFileContents.length === 0 && allLogs.length === 0) {
      showStatus('No log file loaded', 'error');
      return;
    }

    setIsSearching(true);
    
    // Parse files on first search if not already parsed
    if (rawFileContents.length > 0 && allLogs.length === 0) {
      showStatus(`Parsing ${rawFileContents.length} log file(s)...`, 'info');
      
      let allParsedLogs: LogEntry[] = [];
      let anyTruncated = false;
      let totalLinesCount = 0;
      let maxLinesLimit = 0;
      
      for (const result of rawFileContents) {
        const parseResult = await window.electronAPI.parseLog(result.content);
        // Extract logs and truncation info
        const logs = parseResult.logs;
        const truncated = parseResult.truncated;
        const totalLines = parseResult.totalLines;
        
        if (truncated) {
          anyTruncated = true;
          maxLinesLimit = logs.length; // This is the limit
        }
        totalLinesCount += totalLines;
        
        // Add file source to each log entry
        logs.forEach(log => {
          log.sourceFile = result.filePath.split(/[\\/]/).pop();
        });
        allParsedLogs = allParsedLogs.concat(logs);
      }
      
      setAllLogs(allParsedLogs);
      // Clear raw contents after parsing
      setRawFileContents([]);
      
      if (anyTruncated) {
        showStatus(
          `Warning: Log file(s) contained ${totalLinesCount.toLocaleString()} lines. Only the first ${maxLinesLimit.toLocaleString()} lines were loaded to prevent memory issues. Consider filtering the log file before opening.`,
          'error'
        );
      } else {
        showStatus(`Parsed ${allParsedLogs.length} log lines. Applying filters...`, 'info');
      }
      
      // Now filter the parsed logs
      const filterData = {
        ...filters,
        startTime: startDate ? formatDateToTimestamp(startDate) : '',
        endTime: endDate ? formatDateToTimestamp(endDate) : ''
      };

      // Use Web Worker for non-blocking search
      if (workerRef.current) {
        workerRef.current.postMessage({ logs: allParsedLogs, filters: filterData });
      }
    } else {
      showStatus('Searching...', 'info');

      // Convert dates to timestamp strings for filtering
      const filterData = {
        ...filters,
        startTime: startDate ? formatDateToTimestamp(startDate) : '',
        endTime: endDate ? formatDateToTimestamp(endDate) : ''
      };

      // Use Web Worker for non-blocking search
      if (workerRef.current) {
        workerRef.current.postMessage({ logs: allLogs, filters: filterData });
      }
    }
  };

  const formatDateToTimestamp = (date: Date): string => {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  };

  const handleClearFilters = () => {
    const clearedFilters: LogFilters = {
      startTime: '',
      endTime: '',
      keywords: '',
      level: 'ALL',
      tag: '',
      pid: ''
    };
    setFilters(clearedFilters);
    setStartDate(null);
    setEndDate(null);
    setFilteredLogs([]);
    showStatus('Filters cleared. Click "Search" to show all logs.', 'info');
  };

  const handleSaveFilters = () => {
    // Save filters excluding time and PID fields
    const filtersToSave = {
      keywords: filters.keywords,
      level: filters.level,
      tag: filters.tag
    };
    localStorage.setItem('ala_saved_filters', JSON.stringify(filtersToSave));
    showStatus('Filters saved successfully!', 'info');
  };

  const handleLoadFilters = () => {
    const savedFilters = localStorage.getItem('ala_saved_filters');
    if (savedFilters) {
      try {
        const parsed = JSON.parse(savedFilters);
        setFilters({
          ...filters,
          keywords: parsed.keywords || '',
          level: parsed.level || 'ALL',
          tag: parsed.tag || ''
          // PID is not restored from saved filters
        });
        showStatus('Filters loaded successfully!', 'info');
      } catch (e) {
        showStatus('Failed to load saved filters', 'error');
      }
    } else {
      showStatus('No saved filters found', 'info');
    }
  };

  const handleImportFilters = async () => {
    const imported = await window.electronAPI.importFilters();
    if (imported) {
      setFilters(imported);
      showStatus('Filters imported successfully!', 'info');
    } else {
      showStatus('Failed to import filters', 'error');
    }
  };

  const handleExportFilters = async () => {
    const success = await window.electronAPI.exportFilters(filters);
    if (success) {
      showStatus('Filters exported successfully!', 'info');
    } else {
      showStatus('Failed to export filters', 'error');
    }
  };

  const handleAnalyzeWithAI = async (prompt?: string) => {
    if (filteredLogs.length === 0) {
      showStatus('No logs to analyze', 'error');
      return;
    }

    showStatus('Analyzing logs with AI...', 'info');
    setActiveTab('ai');
    
    try {
      const analysis = await window.electronAPI.analyzeWithAI({ 
        logs: filteredLogs, 
        prompt 
      });
      setAiAnalysis(analysis);
      showStatus('AI analysis completed', 'info');
    } catch (error) {
      showStatus('AI analysis failed', 'error');
      setAiAnalysis('Failed to analyze logs. Please check your API key and try again.');
    }
  };

  const updateStatistics = async () => {
    if (filteredLogs.length > 0) {
      const stats = await window.electronAPI.getStatistics(filteredLogs);
      setStatistics(stats);
    }
  };

  const handleLoadPreset = (preset: FilterPreset) => {
    // Extract keywords and tag from config
    const keywordTexts = preset.config.keywords.map(k => k.text).join(KEYWORD_SEPARATOR);
    const tagText = preset.config.tag?.text || '';
    
    setFilters({
      ...filters,
      keywords: keywordTexts,
      tag: tagText
    });
    
    // Set descriptions from the preset
    setActivePresetDescriptions({
      keywordDescriptions: preset.config.keywords.map(k => ({ keyword: k.text, description: k.description })),
      tagDescription: preset.config.tag?.description || ''
    });
    showStatus('Preset loaded successfully!', 'info');
  };

  const handleApplyMultiplePresets = (presets: FilterPreset[]) => {
    if (presets.length === 0) return;
    
    // Merge multiple presets - combine keywords and tags with OR operator (|)
    // Note: Log level is not merged from presets - it remains at ALL or user's manual selection
    const mergedFilters: LogFilters = {
      startTime: '',
      endTime: '',
      keywords: '',
      level: 'ALL',
      tag: '',
      pid: ''
    };

    // Merge keyword descriptions
    const allKeywordDescriptions: { keyword: string; description: string }[] = [];
    presets.forEach(p => {
      p.config.keywords.forEach(k => {
        allKeywordDescriptions.push({ keyword: k.text, description: k.description });
      });
    });

    // Merge tag descriptions (join with semicolon if multiple)
    const allTagDescriptions = presets
      .map(p => p.config.tag?.description)
      .filter(d => d && d.trim())
      .join('; ');

    // Combine keywords with OR operator
    const allKeywords = presets
      .flatMap(p => p.config.keywords.map(k => k.text))
      .filter(k => k && k.trim())
      .join(KEYWORD_SEPARATOR);
    
    if (allKeywords) {
      mergedFilters.keywords = allKeywords;
    }

    // Combine tags with OR operator
    const allTags = presets
      .map(p => p.config.tag?.text)
      .filter(t => t && t.trim())
      .join(KEYWORD_SEPARATOR);
    
    if (allTags) {
      mergedFilters.tag = allTags;
    }

    setFilters(mergedFilters);
    setActivePresetDescriptions({
      keywordDescriptions: allKeywordDescriptions,
      tagDescription: allTagDescriptions
    });
    showStatus(`Applied ${presets.length} presets. Keywords and tags combined with OR.`, 'info');
  };

  const handleToggleTheme = () => {
    const newTheme = themeMode === 'dark' ? 'light' : 'dark';
    setThemeMode(newTheme);
    localStorage.setItem('ala_theme', newTheme);
  };

  const handleDeleteFile = async (filePath: string) => {
    // Remove from currentFiles
    const updatedFiles = currentFiles.filter(f => f !== filePath);
    setCurrentFiles(updatedFiles);
    
    // Remove from raw file contents if not yet parsed
    const updatedRawContents = rawFileContents.filter(f => f.filePath !== filePath);
    setRawFileContents(updatedRawContents);
    
    // Remove logs from this file
    const fileName = filePath.split(/[\\/]/).pop();
    const updatedAllLogs = allLogs.filter(log => log.sourceFile !== fileName);
    const updatedFilteredLogs = filteredLogs.filter(log => log.sourceFile !== fileName);
    
    setAllLogs(updatedAllLogs);
    setFilteredLogs(updatedFilteredLogs);
    
    // Call IPC to confirm deletion (just returns success)
    await window.electronAPI.deleteLogFile(filePath);
    
    showStatus(`Removed ${fileName} from view`, 'info');
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: themeMode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: themeMode === 'dark' ? '#4ec9b0' : '#1890ff',
          colorBgContainer: themeMode === 'dark' ? '#252526' : '#ffffff',
          colorBgElevated: themeMode === 'dark' ? '#2d2d2d' : '#f5f5f5',
          colorText: themeMode === 'dark' ? '#d4d4d4' : '#000000',
          colorBorder: themeMode === 'dark' ? '#3e3e42' : '#d9d9d9',
        },
      }}
    >
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: themeMode === 'dark' ? '#1e1e1e' : '#ffffff',
        color: themeMode === 'dark' ? '#d4d4d4' : '#000000'
      }}>
        <Header 
          onToggleDrawer={() => setDrawerOpen(!drawerOpen)}
          theme={themeMode}
          onToggleTheme={handleToggleTheme}
          onManagePresets={() => setPresetManagerVisible(true)}
        />
      
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <ControlPanel
            filters={filters}
            setFilters={setFilters}
            startDate={startDate}
            endDate={endDate}
            setStartDate={setStartDate}
            setEndDate={setEndDate}
            onOpenFiles={handleOpenFiles}
            onSearch={handleSearch}
            onClearFilters={handleClearFilters}
            onSaveFilters={handleSaveFilters}
            onLoadFilters={handleLoadFilters}
            onImportFilters={handleImportFilters}
            onExportFilters={handleExportFilters}
            onAnalyzeWithAI={handleAnalyzeWithAI}
            currentFiles={currentFiles}
            aiConfigured={aiConfigured}
            statusMessage={statusMessage}
            statusType={statusType}
            isSearching={isSearching}
            drawerOpen={drawerOpen}
            onDrawerClose={() => setDrawerOpen(false)}
            onLoadPreset={handleLoadPreset}
            onApplyMultiplePresets={handleApplyMultiplePresets}
            onDeleteFile={handleDeleteFile}
          />
          
          <LogViewer
            logs={filteredLogs}
            allLogsCount={allLogs.length}
            statistics={statistics}
            currentFiles={currentFiles}
            keywords={filters.keywords}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            aiAnalysis={aiAnalysis}
            isSearching={isSearching}
            lineBreakMode={lineBreakMode}
            onLineBreakModeChange={setLineBreakMode}
            themeMode={themeMode}
            keywordDescriptions={activePresetDescriptions.keywordDescriptions}
            tagDescription={activePresetDescriptions.tagDescription}
            currentTag={filters.tag}
          />
        </div>
        
        <FilterPresetManager
          visible={presetManagerVisible}
          onClose={() => setPresetManagerVisible(false)}
          onLoadPreset={handleLoadPreset}
          onApplyMultiplePresets={handleApplyMultiplePresets}
        />
      </div>
    </ConfigProvider>
  );
};

export default App;
