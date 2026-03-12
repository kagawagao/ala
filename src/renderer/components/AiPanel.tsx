import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Input, Select, Tag, Typography } from 'antd';
import {
  CloseOutlined,
  FileAddOutlined,
  RobotOutlined,
  SendOutlined,
  StopOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LogEntry } from '../types';
import {
  analyzeLogsStream,
  getPresetList,
  isAIConfigured,
  MAX_SOURCE_CODE_SIZE,
} from '../services/ai-service';

const { Text } = Typography;

interface AiPanelProps {
  open: boolean;
  onClose: () => void;
  filteredLogs: LogEntry[];
  sourceFiles: { filePath: string; content: string }[];
  onOpenSourceFiles: () => void;
  onRemoveSourceFile: (filePath: string) => void;
  onOpenSettings: () => void;
  language: string;
}

const AiPanel: React.FC<AiPanelProps> = ({
  open,
  onClose,
  filteredLogs,
  sourceFiles,
  onOpenSourceFiles,
  onRemoveSourceFile,
  onOpenSettings,
  language,
}) => {
  const { t } = useTranslation();
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [selectedAIPreset, setSelectedAIPreset] = useState<string>('general');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [streamContent, setStreamContent] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const aiConfigured = isAIConfigured();
  const presetList = getPresetList();

  // Auto-scroll to bottom as content streams in
  useEffect(() => {
    if (resultContainerRef.current && isAnalyzing) {
      resultContainerRef.current.scrollTop = resultContainerRef.current.scrollHeight;
    }
  }, [streamContent, isAnalyzing]);

  const handleAnalyze = useCallback(async () => {
    if (filteredLogs.length === 0) {
      setErrorMessage(t('noLogsToAnalyze'));
      return;
    }

    if (!isAIConfigured()) {
      setErrorMessage(t('aiNotConfigured'));
      return;
    }

    setIsAnalyzing(true);
    setStreamContent('');
    setErrorMessage('');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Build source code string with size limit
    let sourceCode: string | undefined = undefined;

    if (sourceFiles.length > 0) {
      let combinedSize = 0;
      const includedFiles: string[] = [];

      for (const file of sourceFiles) {
        const fileSize = new Blob([file.content]).size;
        if (combinedSize + fileSize <= MAX_SOURCE_CODE_SIZE) {
          combinedSize += fileSize;
          const fileName = file.filePath.split(/[\\/]/).pop();
          includedFiles.push(`// File: ${fileName}\n${file.content}`);
        } else {
          break;
        }
      }

      if (includedFiles.length > 0) {
        sourceCode = includedFiles.join('\n\n');
      }
    }

    await analyzeLogsStream({
      logs: filteredLogs,
      prompt: aiPrompt || undefined,
      presetId: selectedAIPreset,
      sourceCode,
      language,
      onChunk: (chunk: string) => {
        setStreamContent((prev) => prev + chunk);
      },
      onDone: () => {
        setIsAnalyzing(false);
        abortControllerRef.current = null;
      },
      onError: (error: string) => {
        setIsAnalyzing(false);
        setErrorMessage(error);
        abortControllerRef.current = null;
      },
      signal: controller.signal,
    });
  }, [filteredLogs, aiPrompt, selectedAIPreset, sourceFiles, language, t]);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsAnalyzing(false);
    }
  }, []);

  const handleClear = useCallback(() => {
    setStreamContent('');
    setErrorMessage('');
  }, []);

  // Markdown component styles based on theme
  const markdownStyles: React.CSSProperties = {
    color: 'var(--ant-color-text)',
    lineHeight: 1.7,
    fontSize: '14px',
    wordBreak: 'break-word',
  };

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <RobotOutlined style={{ color: '#c586c0', fontSize: '18px' }} />
          <span>{t('aiAnalysis')}</span>
        </div>
      }
      placement="right"
      width={520}
      open={open}
      onClose={onClose}
      closeIcon={<CloseOutlined />}
      styles={{
        body: {
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {/* Configuration Section */}
        <div
          style={{
            padding: '16px',
            borderBottom: '1px solid var(--ant-color-border)',
            flexShrink: 0,
          }}
        >
          {/* Preset Selector */}
          <div style={{ marginBottom: '12px' }}>
            <Text
              type="secondary"
              style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}
            >
              {t('selectAIPreset')}
            </Text>
            <Select
              value={selectedAIPreset}
              onChange={setSelectedAIPreset}
              style={{ width: '100%' }}
              disabled={isAnalyzing}
              options={presetList.map((preset) => ({
                value: preset.id,
                label: t(preset.nameKey),
              }))}
            />
          </div>

          {/* Source Code Files */}
          <div style={{ marginBottom: '12px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '4px',
              }}
            >
              <Text type="secondary" style={{ fontSize: '12px' }}>
                {t('sourceCodeFiles')}
              </Text>
              <Button
                type="link"
                size="small"
                icon={<FileAddOutlined />}
                onClick={onOpenSourceFiles}
                disabled={isAnalyzing}
                style={{ padding: 0, height: 'auto' }}
              >
                {t('addSourceFiles')}
              </Button>
            </div>
            {sourceFiles.length > 0 ? (
              <div
                style={{
                  maxHeight: '80px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '4px',
                }}
              >
                {sourceFiles.map((file) => {
                  const fileName = file.filePath.split(/[\\/]/).pop();
                  return (
                    <Tag
                      key={file.filePath}
                      closable={!isAnalyzing}
                      onClose={(e) => {
                        e.preventDefault();
                        onRemoveSourceFile(file.filePath);
                      }}
                      style={{ margin: 0, maxWidth: '200px' }}
                    >
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'inline-block',
                          maxWidth: '160px',
                          verticalAlign: 'middle',
                        }}
                      >
                        {fileName}
                      </span>
                    </Tag>
                  );
                })}
              </div>
            ) : (
              <Text
                type="secondary"
                style={{
                  fontSize: '12px',
                  display: 'block',
                  padding: '8px',
                  textAlign: 'center',
                  backgroundColor: 'var(--ant-color-bg-elevated)',
                  borderRadius: '6px',
                }}
              >
                {t('noSourceFilesAdded')}
              </Text>
            )}
          </div>

          {/* Prompt Input */}
          <div style={{ marginBottom: '12px' }}>
            <Input.TextArea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder={t('aiPromptOptional')}
              rows={3}
              style={{ resize: 'vertical' }}
              disabled={isAnalyzing}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {isAnalyzing ? (
              <Button type="primary" danger icon={<StopOutlined />} onClick={handleStop} block>
                {t('stopAnalysis')}
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleAnalyze}
                disabled={!aiConfigured || filteredLogs.length === 0}
                block
                style={{
                  backgroundColor: aiConfigured && filteredLogs.length > 0 ? '#c586c0' : undefined,
                  borderColor: aiConfigured && filteredLogs.length > 0 ? '#c586c0' : undefined,
                }}
              >
                {t('analyzeWithAI')}
              </Button>
            )}
            {streamContent && !isAnalyzing && (
              <Button icon={<DeleteOutlined />} onClick={handleClear} title={t('clearResults')} />
            )}
          </div>

          {/* Not configured warning */}
          {!aiConfigured && (
            <Alert
              message={t('aiNotConfigured')}
              type="warning"
              showIcon
              style={{ marginTop: '8px', fontSize: '12px' }}
              action={
                <Button size="small" type="link" onClick={onOpenSettings}>
                  {t('settings')}
                </Button>
              }
            />
          )}
        </div>

        {/* Results Section - scrollable */}
        <div
          ref={resultContainerRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            minHeight: 0,
          }}
        >
          {errorMessage && (
            <Alert
              message={errorMessage}
              type="error"
              showIcon
              closable
              onClose={() => setErrorMessage('')}
              style={{ marginBottom: '12px' }}
            />
          )}

          {streamContent ? (
            <div className="ai-markdown-content" style={markdownStyles}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamContent}</ReactMarkdown>
            </div>
          ) : !isAnalyzing && !errorMessage ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--ant-color-text-secondary)',
                textAlign: 'center',
                padding: '24px',
              }}
            >
              <RobotOutlined style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.3 }} />
              <Text type="secondary">{t('aiEmptyState')}</Text>
            </div>
          ) : null}

          {/* Streaming indicator */}
          {isAnalyzing && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 0',
                color: 'var(--ant-color-text-secondary)',
              }}
            >
              <span className="ai-typing-indicator">
                <span className="ai-dot" />
                <span className="ai-dot" />
                <span className="ai-dot" />
              </span>
              <Text type="secondary" style={{ fontSize: '12px' }}>
                {t('aiAnalyzing')}
              </Text>
            </div>
          )}
        </div>
      </div>

      {/* CSS animations */}
      <style>{`
        .ai-typing-indicator {
          display: inline-flex;
          gap: 4px;
          align-items: center;
        }
        .ai-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background-color: #c586c0;
          animation: ai-bounce 1.4s ease-in-out infinite;
        }
        .ai-dot:nth-child(1) { animation-delay: 0s; }
        .ai-dot:nth-child(2) { animation-delay: 0.2s; }
        .ai-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes ai-bounce {
          0%, 80%, 100% {
            transform: scale(0.6);
            opacity: 0.4;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
        }
        .ai-markdown-content h1,
        .ai-markdown-content h2,
        .ai-markdown-content h3,
        .ai-markdown-content h4 {
          color: var(--ant-color-text);
          margin-top: 16px;
          margin-bottom: 8px;
        }
        .ai-markdown-content h1 { font-size: 20px; }
        .ai-markdown-content h2 { font-size: 18px; }
        .ai-markdown-content h3 { font-size: 16px; }
        .ai-markdown-content p {
          margin-bottom: 8px;
        }
        .ai-markdown-content ul,
        .ai-markdown-content ol {
          padding-left: 20px;
          margin-bottom: 8px;
        }
        .ai-markdown-content li {
          margin-bottom: 4px;
        }
        .ai-markdown-content code {
          background-color: var(--ant-color-bg-elevated);
          padding: 2px 6px;
          border-radius: 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
        }
        .ai-markdown-content pre {
          background-color: var(--ant-color-bg-elevated);
          padding: 12px;
          border-radius: 6px;
          overflow-x: auto;
          margin-bottom: 8px;
        }
        .ai-markdown-content pre code {
          background: none;
          padding: 0;
        }
        .ai-markdown-content table {
          border-collapse: collapse;
          width: 100%;
          margin-bottom: 8px;
        }
        .ai-markdown-content th,
        .ai-markdown-content td {
          border: 1px solid var(--ant-color-border);
          padding: 8px;
          text-align: left;
        }
        .ai-markdown-content th {
          background-color: var(--ant-color-bg-elevated);
          font-weight: 600;
        }
        .ai-markdown-content blockquote {
          border-left: 4px solid #c586c0;
          margin: 8px 0;
          padding: 8px 16px;
          color: var(--ant-color-text-secondary);
          background-color: var(--ant-color-bg-elevated);
          border-radius: 0 6px 6px 0;
        }
        .ai-markdown-content a {
          color: var(--ant-color-primary);
        }
        .ai-markdown-content hr {
          border: none;
          border-top: 1px solid var(--ant-color-border);
          margin: 16px 0;
        }
      `}</style>
    </Drawer>
  );
};

export default AiPanel;
