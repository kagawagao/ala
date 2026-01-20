import React from 'react';
import { LogFilters } from '../types';
import DateTimeRangePicker from './DateTimeRangePicker';
import { 
  Drawer, 
  Button, 
  Input, 
  Select, 
  Space, 
  Divider, 
  Alert,
  Radio,
  FloatButton
} from 'antd';
import {
  FolderOpenOutlined,
  SearchOutlined,
  ClearOutlined,
  SaveOutlined,
  FolderOutlined,
  ImportOutlined,
  ExportOutlined,
  RobotOutlined,
  SettingOutlined,
  LoadingOutlined
} from '@ant-design/icons';

interface ControlPanelProps {
  filters: LogFilters;
  setFilters: (filters: LogFilters) => void;
  startDate: Date | null;
  endDate: Date | null;
  setStartDate: (date: Date | null) => void;
  setEndDate: (date: Date | null) => void;
  onOpenFiles: () => void;
  onSearch: () => void;
  onClearFilters: () => void;
  onSaveFilters: () => void;
  onLoadFilters: () => void;
  onImportFilters: () => void;
  onExportFilters: () => void;
  onAnalyzeWithAI: (prompt?: string) => void;
  currentFiles: string[];
  aiConfigured: boolean;
  statusMessage: string;
  statusType: 'info' | 'error';
  isSearching: boolean;
  drawerOpen: boolean;
  onDrawerClose: () => void;
  onManagePresets: () => void;
  lineBreakMode: 'wrap' | 'nowrap';
  onLineBreakModeChange: (mode: 'wrap' | 'nowrap') => void;
  onLoadPreset: (filters: LogFilters) => void;
  onDeleteFile: (filePath: string) => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  filters,
  setFilters,
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  onOpenFiles,
  onSearch,
  onClearFilters,
  onSaveFilters,
  onLoadFilters,
  onImportFilters,
  onExportFilters,
  onAnalyzeWithAI,
  currentFiles,
  aiConfigured,
  statusMessage,
  statusType,
  isSearching,
  drawerOpen,
  onDrawerClose,
  onManagePresets,
  lineBreakMode,
  onLineBreakModeChange,
  onLoadPreset,
  onDeleteFile,
}) => {
  const [aiPrompt, setAiPrompt] = React.useState<string>('');
  const [aiPanelOpen, setAiPanelOpen] = React.useState<boolean>(false);

  const updateFilter = (key: keyof LogFilters, value: string) => {
    setFilters({ ...filters, [key]: value });
  };

  return (
    <>
      <Drawer
        title="Control Panel"
        placement="right"
        onClose={onDrawerClose}
        open={drawerOpen}
        width={400}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* File Controls */}
          <div>
            <Button 
              type="primary"
              icon={<FolderOpenOutlined />}
              onClick={onOpenFiles}
              block
              size="large"
            >
              Open Log File(s)
            </Button>
            {currentFiles.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {currentFiles.map((file, index) => (
                  <div 
                    key={index} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      wordBreak: 'break-all',
                      padding: '8px',
                      borderRadius: '4px',
                      backgroundColor: 'var(--ant-color-bg-elevated)'
                    }}
                  >
                    <span style={{ flex: 1 }}>📄 {file.split(/[\\/]/).pop()}</span>
                    {currentFiles.length > 1 && (
                      <Button
                        type="text"
                        size="small"
                        danger
                        onClick={() => onDeleteFile(file)}
                        style={{ marginLeft: '8px' }}
                      >
                        ✕
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Line Break Mode */}
          <div>
            <label style={{ fontSize: '12px', color: 'var(--ant-color-text-secondary)', marginBottom: '4px', display: 'block' }}>
              Line Break Mode:
            </label>
            <Radio.Group 
              value={lineBreakMode}
              onChange={(e) => onLineBreakModeChange(e.target.value)}
              buttonStyle="solid"
              style={{ width: '100%' }}
            >
              <Radio.Button value="wrap" style={{ width: '50%', textAlign: 'center' }}>Word Wrap</Radio.Button>
              <Radio.Button value="nowrap" style={{ width: '50%', textAlign: 'center' }}>No Wrap</Radio.Button>
            </Radio.Group>
          </div>

          <Divider style={{ margin: '8px 0' }}>Filters</Divider>
          
          {/* Time Range with DatePicker */}
          <div>
            <DateTimeRangePicker
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
            />
          </div>

          {/* Keywords */}
          <div>
            <label style={{ fontSize: '12px', color: 'var(--ant-color-text-secondary)', marginBottom: '4px', display: 'block' }}>
              Keywords (regex supported):
            </label>
            <Input 
              value={filters.keywords}
              onChange={(e) => updateFilter('keywords', e.target.value)}
              placeholder="e.g., error|crash|exception" 
            />
          </div>

          {/* Log Level */}
          <div>
            <label style={{ fontSize: '12px', color: 'var(--ant-color-text-secondary)', marginBottom: '4px', display: 'block' }}>
              Log Level:
            </label>
            <Select 
              value={filters.level}
              onChange={(value) => updateFilter('level', value)}
              style={{ width: '100%' }}
              options={[
                { value: 'ALL', label: 'All' },
                { value: 'V', label: 'Verbose' },
                { value: 'D', label: 'Debug' },
                { value: 'I', label: 'Info' },
                { value: 'W', label: 'Warning' },
                { value: 'E', label: 'Error' },
                { value: 'F', label: 'Fatal' },
              ]}
            />
          </div>

          {/* Tag Filter */}
          <div>
            <label style={{ fontSize: '12px', color: 'var(--ant-color-text-secondary)', marginBottom: '4px', display: 'block' }}>
              Tag Filter (regex):
            </label>
            <Input 
              value={filters.tag}
              onChange={(e) => updateFilter('tag', e.target.value)}
              placeholder="e.g., Activity.*" 
            />
          </div>

          {/* PID */}
          <div>
            <label style={{ fontSize: '12px', color: 'var(--ant-color-text-secondary)', marginBottom: '4px', display: 'block' }}>
              PID:
            </label>
            <Input 
              value={filters.pid}
              onChange={(e) => updateFilter('pid', e.target.value)}
              placeholder="e.g., 12345" 
            />
          </div>

          {/* Search/Clear Buttons */}
          <Space.Compact block>
            <Button 
              type="primary"
              icon={isSearching ? <LoadingOutlined /> : <SearchOutlined />}
              onClick={onSearch}
              disabled={isSearching}
              style={{ flex: 1 }}
            >
              {isSearching ? 'Searching...' : 'Search'}
            </Button>
            <Button 
              icon={<ClearOutlined />}
              onClick={onClearFilters}
              disabled={isSearching}
            >
              Clear
            </Button>
          </Space.Compact>
          
          {/* Save/Load Buttons */}
          <Space.Compact block>
            <Button 
              icon={<SaveOutlined />}
              onClick={onSaveFilters}
              style={{ flex: 1 }}
            >
              Save
            </Button>
            <Button 
              icon={<FolderOutlined />}
              onClick={onLoadFilters}
              style={{ flex: 1 }}
            >
              Load
            </Button>
          </Space.Compact>

          {/* Import/Export Buttons */}
          <Space.Compact block>
            <Button 
              icon={<ImportOutlined />}
              onClick={onImportFilters}
              style={{ flex: 1 }}
            >
              Import
            </Button>
            <Button 
              icon={<ExportOutlined />}
              onClick={onExportFilters}
              style={{ flex: 1 }}
            >
              Export
            </Button>
          </Space.Compact>

          {/* Manage Presets Button */}
          <Button 
            icon={<SettingOutlined />}
            onClick={onManagePresets}
            block
          >
            Manage Presets
          </Button>

          {/* Filter Presets Collapse */}
          {/* Note: Presets are managed via the "Manage Presets" button below */}

          {/* Status Message */}
          {statusMessage && (
            <Alert 
              message={statusMessage}
              type={statusType === 'info' ? 'info' : 'error'}
              showIcon
              closable
            />
          )}
        </Space>
      </Drawer>

      {/* Floating AI Analysis Panel */}
      <FloatButton
        icon={<RobotOutlined />}
        type="primary"
        style={{ 
          right: 24, 
          bottom: 24,
          width: 56,
          height: 56,
          backgroundColor: '#c586c0'
        }}
        onClick={() => setAiPanelOpen(!aiPanelOpen)}
        tooltip="AI Analysis"
      />

      {aiPanelOpen && (
        <div
          style={{
            position: 'fixed',
            right: 24,
            bottom: 100,
            width: 400,
            maxHeight: 500,
            backgroundColor: 'var(--ant-color-bg-container)',
            border: '1px solid var(--ant-color-border)',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            padding: '16px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, color: 'var(--ant-color-primary)' }}>AI Analysis</h3>
            <Button 
              type="text" 
              size="small" 
              onClick={() => setAiPanelOpen(false)}
            >
              ✕
            </Button>
          </div>
          
          <Input.TextArea 
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="Optional: Enter specific questions or analysis requests for the AI..." 
            rows={4} 
            style={{ resize: 'vertical' }}
          />
          
          <Button 
            type="primary"
            icon={<RobotOutlined />}
            onClick={() => {
              onAnalyzeWithAI(aiPrompt);
              setAiPanelOpen(false);
            }}
            disabled={!aiConfigured}
            block
            size="large"
            style={{
              backgroundColor: '#c586c0',
              borderColor: '#c586c0'
            }}
          >
            Analyze with AI
          </Button>

          {!aiConfigured && (
            <Alert 
              message="AI features require OPENAI_API_KEY environment variable"
              type="warning"
              showIcon
              style={{ fontSize: '12px' }}
            />
          )}
        </div>
      )}
    </>
  );
};

export default ControlPanel;
