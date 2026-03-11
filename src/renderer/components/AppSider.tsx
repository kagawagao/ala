import React, { useEffect } from 'react';
import {
  Layout,
  Button,
  Space,
  Divider,
  Input,
  Select,
  Alert,
  FloatButton,
  Form,
  DatePicker,
  Tag,
} from 'antd';
import {
  FolderOpenOutlined,
  SearchOutlined,
  ClearOutlined,
  RobotOutlined,
  LoadingOutlined,
  SettingOutlined,
  ToolOutlined,
  FileAddOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs, { Dayjs } from 'dayjs';
import { LogFilters } from '../types';
import { FilterPreset } from './FilterPresetManager';
import { getHighlightColorById } from '../constants/highlightColors';

const { Sider } = Layout;
const { RangePicker } = DatePicker;

interface AppSiderProps {
  filters: LogFilters;
  setFilters: (filters: LogFilters) => void;
  startDate: Date | null;
  endDate: Date | null;
  setStartDate: (date: Date | null) => void;
  setEndDate: (date: Date | null) => void;
  onOpenFiles: () => void;
  onSearch: () => void;
  onClearFilters: () => void;
  onAnalyzeWithAI: (prompt?: string, presetId?: string) => void;
  currentFiles: string[];
  sourceFiles: { filePath: string; content: string }[];
  onOpenSourceFiles: () => void;
  onRemoveSourceFile: (filePath: string) => void;
  aiConfigured: boolean;
  statusMessage: string;
  statusType: 'info' | 'error';
  isSearching: boolean;
  onLoadPreset: (preset: FilterPreset) => void;
  onApplyMultiplePresets: (presets: FilterPreset[]) => void;
  onDeleteFile: (filePath: string) => void;
  presets: FilterPreset[];
  onManagePresets: () => void;
  onOpenSettings: () => void;
  themeMode: 'dark' | 'light';
  onRemoveColoredHighlight?: (pattern: string) => void;
}

const AppSider: React.FC<AppSiderProps> = ({
  filters,
  setFilters,
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  onOpenFiles,
  onSearch,
  onClearFilters,
  onAnalyzeWithAI,
  currentFiles,
  sourceFiles,
  onOpenSourceFiles,
  onRemoveSourceFile,
  aiConfigured,
  statusMessage,
  statusType,
  isSearching,
  onLoadPreset,
  onApplyMultiplePresets,
  onDeleteFile,
  presets,
  onManagePresets,
  onOpenSettings,
  themeMode,
  onRemoveColoredHighlight,
}) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [aiPrompt, setAiPrompt] = React.useState<string>('');
  const [aiPanelOpen, setAiPanelOpen] = React.useState<boolean>(false);
  const [selectedPresetIds, setSelectedPresetIds] = React.useState<string[]>([]);
  const [selectedAIPreset, setSelectedAIPreset] = React.useState<string>('general');

  // Initialize form with current filters and time range
  useEffect(() => {
    const timeRange: [Dayjs | null, Dayjs | null] | null =
      startDate || endDate
        ? [startDate ? dayjs(startDate) : null, endDate ? dayjs(endDate) : null]
        : null;

    form.setFieldsValue({
      ...filters,
      timeRange,
    });
  }, [filters, startDate, endDate, form]);

  // Handle form value changes
  const handleValuesChange = (
    changedValues: Record<string, unknown>,
    allValues: Record<string, unknown>
  ) => {
    // Handle time range separately
    if ('timeRange' in changedValues) {
      const timeRange = changedValues.timeRange as [Dayjs, Dayjs] | null | undefined;
      if (!timeRange) {
        setStartDate(null);
        setEndDate(null);
      } else {
        const [start, end] = timeRange;
        setStartDate(start ? start.toDate() : null);
        setEndDate(end ? end.toDate() : null);
      }
    }

    // Update filters (excluding timeRange which is not part of LogFilters)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { timeRange: _timeRange, ...filterValues } = allValues;
    setFilters(filterValues as unknown as LogFilters);
  };

  return (
    <>
      <Sider
        width={380}
        style={{
          backgroundColor: themeMode === 'dark' ? '#252526' : '#f5f5f5',
          overflow: 'auto',
          height: '100%',
          borderRight: `1px solid ${themeMode === 'dark' ? '#3e3e42' : '#d9d9d9'}`,
        }}
      >
        <div
          style={{
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
          }}
        >
          {/* Main controls area */}
          <div style={{ flex: 1, overflow: 'auto' }}>
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
                  {t('openFiles')}
                </Button>
                {currentFiles.length > 0 && (
                  <div
                    style={{
                      marginTop: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
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
                          backgroundColor: 'var(--ant-color-bg-elevated)',
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

              <Divider style={{ margin: '8px 0' }}>{t('filters')}</Divider>

              {/* Filter Form */}
              <Form
                form={form}
                layout="vertical"
                onValuesChange={handleValuesChange}
                initialValues={filters}
              >
                {/* Time Range with DatePicker */}
                <Form.Item name="timeRange" label={t('timeRange')} style={{ marginBottom: '16px' }}>
                  <RangePicker
                    showTime={{
                      format: 'HH:mm:ss',
                    }}
                    format="MM-DD HH:mm:ss"
                    placeholder={[t('startTime'), t('endTime')]}
                    style={{ width: '100%' }}
                    allowClear
                  />
                </Form.Item>

                {/* Keywords (Filter) */}
                <Form.Item name="keywords" label={t('keywords')} style={{ marginBottom: '16px' }}>
                  <Input placeholder={t('keywordsPlaceholder')} />
                </Form.Item>

                {/* Highlights (Visual Only) */}
                <Form.Item
                  name="highlights"
                  label={t('highlights')}
                  style={{ marginBottom: '16px' }}
                >
                  <Input placeholder={t('highlightsPlaceholder')} />
                </Form.Item>

                {/* Colored Highlights Display */}
                {filters.coloredHighlights && filters.coloredHighlights.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <div
                      style={{
                        fontSize: '14px',
                        color: 'var(--ant-color-text)',
                        marginBottom: '8px',
                      }}
                    >
                      {t('coloredHighlights')}:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {filters.coloredHighlights.map((highlight, index) => {
                        const colors = getHighlightColorById(highlight.color, themeMode);
                        return (
                          <Tag
                            key={`${highlight.pattern}-${index}`}
                            closable
                            onClose={(e) => {
                              e.preventDefault();
                              if (onRemoveColoredHighlight) {
                                onRemoveColoredHighlight(highlight.pattern);
                              }
                            }}
                            style={{
                              backgroundColor: colors.background,
                              color: colors.text,
                              border: 'none',
                              marginRight: 0,
                            }}
                          >
                            {highlight.pattern}
                          </Tag>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Log Level */}
                <Form.Item name="level" label={t('logLevel')} style={{ marginBottom: '16px' }}>
                  <Select
                    options={[
                      { value: 'ALL', label: t('allLevels') },
                      { value: 'V', label: t('verbose') },
                      { value: 'D', label: t('debug') },
                      { value: 'I', label: t('info') },
                      { value: 'W', label: t('warning') },
                      { value: 'E', label: t('error') },
                      { value: 'F', label: t('fatal') },
                    ]}
                  />
                </Form.Item>

                {/* Tag Filter */}
                <Form.Item name="tag" label={t('tagFilterRegex')} style={{ marginBottom: '16px' }}>
                  <Input placeholder={t('tagPlaceholder')} />
                </Form.Item>

                {/* PID */}
                <Form.Item name="pid" label={t('pid')} style={{ marginBottom: '16px' }}>
                  <Input placeholder={t('pidPlaceholder')} />
                </Form.Item>
              </Form>

              {/* Search/Clear Buttons */}
              <Space.Compact block>
                <Button
                  type="primary"
                  icon={isSearching ? <LoadingOutlined /> : <SearchOutlined />}
                  onClick={onSearch}
                  disabled={isSearching}
                  style={{ flex: 1 }}
                >
                  {isSearching ? t('searching') : t('search')}
                </Button>
                <Button icon={<ClearOutlined />} onClick={onClearFilters} disabled={isSearching}>
                  {t('clearFilters')}
                </Button>
              </Space.Compact>

              {/* Apply Preset */}
              {presets.length > 0 && (
                <>
                  <Divider style={{ margin: '8px 0' }}>{t('applyPreset')}</Divider>
                  <div>
                    <label
                      style={{
                        fontSize: '12px',
                        color: 'var(--ant-color-text-secondary)',
                        marginBottom: '4px',
                        display: 'block',
                      }}
                    >
                      {t('selectPreset')}:
                    </label>
                    <Select
                      mode="multiple"
                      style={{ width: '100%' }}
                      placeholder={t('selectPresetToApply')}
                      value={selectedPresetIds}
                      onChange={(values) => {
                        setSelectedPresetIds(values);
                        // Immediate application - apply on selection change
                        if (values.length > 0) {
                          const selectedPresets = presets.filter((p) => values.includes(p.id));
                          if (selectedPresets.length === 1) {
                            onLoadPreset(selectedPresets[0]);
                          } else if (selectedPresets.length > 1) {
                            onApplyMultiplePresets(selectedPresets);
                          }
                        }
                      }}
                      options={presets.map((preset) => ({
                        value: preset.id,
                        label: preset.name,
                      }))}
                      allowClear
                      maxTagCount={3}
                    />
                  </div>
                </>
              )}

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
          </div>

          {/* Bottom menu buttons */}
          <div
            style={{
              marginTop: '16px',
              paddingTop: '16px',
              borderTop: `1px solid ${themeMode === 'dark' ? '#3e3e42' : '#d9d9d9'}`,
            }}
          >
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Button type="default" icon={<SettingOutlined />} onClick={onManagePresets} block>
                {t('managePresets')}
              </Button>
              <Button type="default" icon={<ToolOutlined />} onClick={onOpenSettings} block>
                {t('settings')}
              </Button>
            </Space>
          </div>
        </div>
      </Sider>

      {/* Floating AI Analysis Panel */}
      <FloatButton
        icon={<RobotOutlined />}
        type="primary"
        style={{
          right: 24,
          bottom: 24,
          width: 56,
          height: 56,
          backgroundColor: '#c586c0',
        }}
        onClick={() => setAiPanelOpen(!aiPanelOpen)}
        tooltip={t('aiAnalysisTooltip')}
      />

      {aiPanelOpen && (
        <div
          role="dialog"
          aria-label={t('aiAnalysisPanel')}
          aria-modal="true"
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
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, color: 'var(--ant-color-primary)' }}>{t('aiAnalysis')}</h3>
            <Button
              type="text"
              size="small"
              onClick={() => setAiPanelOpen(false)}
              aria-label={t('closeAiPanel')}
            >
              ✕
            </Button>
          </div>

          <Select
            value={selectedAIPreset}
            onChange={setSelectedAIPreset}
            style={{ width: '100%' }}
            placeholder={t('selectAIPreset')}
          >
            <Select.Option value="general">{t('aiPresetGeneral')}</Select.Option>
            <Select.Option value="crash">{t('aiPresetCrash')}</Select.Option>
            <Select.Option value="performance">{t('aiPresetPerformance')}</Select.Option>
            <Select.Option value="security">{t('aiPresetSecurity')}</Select.Option>
            <Select.Option value="network">{t('aiPresetNetwork')}</Select.Option>
            <Select.Option value="lifecycle">{t('aiPresetLifecycle')}</Select.Option>
            <Select.Option value="ui">{t('aiPresetUI')}</Select.Option>
          </Select>

          {/* Source Code Files Section */}
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <span style={{ fontSize: '14px', fontWeight: 500 }}>{t('sourceCodeFiles')}</span>
              <Button
                type="default"
                size="small"
                icon={<FileAddOutlined />}
                onClick={onOpenSourceFiles}
              >
                {t('addSourceFiles')}
              </Button>
            </div>
            {sourceFiles.length > 0 ? (
              <div style={{ maxHeight: '120px', overflowY: 'auto', marginBottom: '12px' }}>
                {sourceFiles.map((file) => {
                  const fileName = file.filePath.split(/[\\/]/).pop();
                  return (
                    <div
                      key={file.filePath}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '4px 8px',
                        backgroundColor: themeMode === 'dark' ? '#3e3e42' : '#f0f0f0',
                        borderRadius: '4px',
                        marginBottom: '4px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '12px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        📄 {fileName}
                      </span>
                      <Button
                        type="text"
                        size="small"
                        danger
                        onClick={() => onRemoveSourceFile(file.filePath)}
                        style={{ padding: '0 4px', minWidth: 'auto' }}
                        aria-label={t('removeSourceFile', { name: fileName })}
                        title={t('removeSourceFile', { name: fileName })}
                      >
                        ✕
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  padding: '12px',
                  textAlign: 'center',
                  fontSize: '12px',
                  color: 'var(--ant-color-text-secondary)',
                  backgroundColor: themeMode === 'dark' ? '#3e3e42' : '#f0f0f0',
                  borderRadius: '4px',
                  marginBottom: '12px',
                }}
              >
                {t('noSourceFilesAdded')}
              </div>
            )}
          </div>

          <Input.TextArea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder={t('aiPromptOptional')}
            rows={4}
            style={{ resize: 'vertical' }}
          />

          <Button
            type="primary"
            icon={<RobotOutlined />}
            onClick={() => {
              onAnalyzeWithAI(aiPrompt, selectedAIPreset);
              setAiPanelOpen(false);
            }}
            disabled={!aiConfigured}
            block
            size="large"
            style={{
              backgroundColor: '#c586c0',
              borderColor: '#c586c0',
            }}
          >
            {t('analyzeWithAI')}
          </Button>

          {!aiConfigured && (
            <Alert
              message={t('aiRequiresKey')}
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

export default AppSider;
