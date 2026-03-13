import React, { useEffect } from 'react';
import {
  Button,
  Space,
  Divider,
  Input,
  Select,
  Alert,
  Form,
  DatePicker,
  Tag,
  Radio,
  Row,
  Col,
} from 'antd';
import {
  FolderOpenOutlined,
  SearchOutlined,
  ClearOutlined,
  LoadingOutlined,
  SettingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs, { Dayjs } from 'dayjs';
import { LogFilters } from '../types';
import { FilterPreset } from './FilterPresetManager';
import { getHighlightColorById } from '../constants/highlightColors';

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
  currentFiles: string[];
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
  currentFiles,
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
  const [selectedPresetIds, setSelectedPresetIds] = React.useState<string[]>([]);

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
    <div
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
              <Button type="primary" icon={<FolderOpenOutlined />} onClick={onOpenFiles} block>
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
              <Form.Item name="timeRange" label={t('timeRange')} style={{ marginBottom: '12px' }}>
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
              <Form.Item name="keywords" label={t('keywords')} style={{ marginBottom: '12px' }}>
                <Input placeholder={t('keywordsPlaceholder')} />
              </Form.Item>

              {/* Tag Filter + AND/OR toggle */}
              <Form.Item label={t('tagFilterRegex')} style={{ marginBottom: '12px' }}>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="tag" noStyle>
                    <Input placeholder={t('tagPlaceholder')} style={{ flex: 1 }} />
                  </Form.Item>
                  <Form.Item name="tagKeywordRelation" noStyle>
                    <Radio.Group optionType="button" buttonStyle="solid" size="middle">
                      <Radio.Button value="AND">{t('relationAnd')}</Radio.Button>
                      <Radio.Button value="OR">{t('relationOr')}</Radio.Button>
                    </Radio.Group>
                  </Form.Item>
                </Space.Compact>
              </Form.Item>

              {/* Highlights (Visual Only) */}
              <Form.Item name="highlights" label={t('highlights')} style={{ marginBottom: '12px' }}>
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
              <Form.Item name="level" label={t('logLevel')} style={{ marginBottom: '12px' }}>
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

              {/* PID and TID in two columns */}
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item name="pid" label={t('pid')} style={{ marginBottom: '12px' }}>
                    <Input placeholder={t('pidPlaceholder')} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="tid" label={t('tid')} style={{ marginBottom: '12px' }}>
                    <Input placeholder={t('tidPlaceholder')} />
                  </Form.Item>
                </Col>
              </Row>
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
    </div>
  );
};

export default AppSider;
