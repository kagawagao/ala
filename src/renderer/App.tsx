import React, { useState, useEffect } from 'react';
import { LogEntry, LogFilters, LogStatistics } from './types';
import Header from './components/Header';
import ControlPanel from './components/ControlPanel';
import LogViewer from './components/LogViewer';

const App: React.FC = () => {
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
  const [currentFiles, setCurrentFiles] = useState<string[]>([]);
  const [statistics, setStatistics] = useState<LogStatistics | null>(null);
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

  useEffect(() => {
    // Check AI configuration on mount
    const checkAI = async () => {
      const configured = await window.electronAPI.checkAIConfigured();
      setAiConfigured(configured);
      if (!configured) {
        showStatus('AI features require OPENAI_API_KEY environment variable', 'info');
      }
    };
    checkAI();

    // Load saved filters from localStorage
    const savedFilters = localStorage.getItem('ala_saved_filters');
    if (savedFilters) {
      try {
        const parsed = JSON.parse(savedFilters);
        setFilters(parsed);
      } catch (e) {
        console.error('Failed to load saved filters:', e);
      }
    }
  }, []);

  useEffect(() => {
    // Update statistics whenever filteredLogs changes
    if (filteredLogs.length > 0) {
      updateStatistics();
    }
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
      
      showStatus(`Parsing ${results.length} log file(s)...`, 'info');
      
      let allParsedLogs: LogEntry[] = [];
      for (const result of results) {
        const logs = await window.electronAPI.parseLog(result.content);
        // Add file source to each log entry
        logs.forEach(log => {
          log.sourceFile = result.filePath.split(/[\\/]/).pop();
        });
        allParsedLogs = allParsedLogs.concat(logs);
      }
      
      setAllLogs(allParsedLogs);
      setFilteredLogs(allParsedLogs);
      
      showStatus(`Loaded ${allParsedLogs.length} log lines from ${results.length} file(s)`, 'info');
    }
  };

  const handleApplyFilters = async () => {
    if (allLogs.length === 0) {
      showStatus('No log file loaded', 'error');
      return;
    }

    showStatus('Applying filters...', 'info');
    const filtered = await window.electronAPI.filterLogs({ logs: allLogs, filters });
    setFilteredLogs(filtered);
    showStatus(`Filtered to ${filtered.length} log lines`, 'info');
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
    setFilteredLogs(allLogs);
    showStatus('Filters cleared', 'info');
  };

  const handleSaveFilters = () => {
    localStorage.setItem('ala_saved_filters', JSON.stringify(filters));
    showStatus('Filters saved successfully!', 'info');
  };

  const handleLoadFilters = () => {
    const savedFilters = localStorage.getItem('ala_saved_filters');
    if (savedFilters) {
      try {
        const parsed = JSON.parse(savedFilters);
        setFilters(parsed);
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

  return (
    <div className="h-screen flex flex-col">
      <Header />
      
      <div className="flex flex-1 overflow-hidden">
        <ControlPanel
          filters={filters}
          setFilters={setFilters}
          onOpenFiles={handleOpenFiles}
          onApplyFilters={handleApplyFilters}
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
        />
      </div>
    </div>
  );
};

export default App;
