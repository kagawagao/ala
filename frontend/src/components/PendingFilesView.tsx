/* eslint-disable react-refresh/only-export-components */
import { FileOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Space, Tag, Typography } from 'antd'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { UnifiedFileInfo } from '../api/files'

export interface PendingFile {
  original_name: string
  saved_path: string | null
  file_type: 'log' | 'pcap' | 'hci' | 'trace'
  format_detected: string
  size_bytes: number
  trace_result?: UnifiedFileInfo['trace_result']
}

export const FILE_TYPE_COLORS: Record<string, string> = {
  log: 'green',
  pcap: 'blue',
  hci: 'purple',
  trace: 'orange',
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface PendingFilesViewProps {
  files: PendingFile[]
  onLoad: (file: PendingFile) => void
  loading: boolean
  error?: string
}

const PendingFilesView: React.FC<PendingFilesViewProps> = ({ files, onLoad, loading, error }) => {
  const { t } = useTranslation()

  const grouped = useMemo(() => {
    const map: Record<string, PendingFile[]> = {}
    files.forEach((f) => {
      const key = f.file_type
      if (!map[key]) map[key] = []
      map[key].push(f)
    })
    return map
  }, [files])

  const typeLabels: Record<string, string> = {
    log: t('logAnalysis'),
    pcap: t('pcapAnalysis'),
    hci: t('hciAnalysis'),
    trace: t('traceAnalysis'),
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 32,
        overflow: 'auto',
      }}
    >
      <Typography.Title level={5} style={{ margin: 0 }}>
        {t('uploadedFiles')}
      </Typography.Title>
      <Typography.Text type="secondary">{t('clickToLoadFile')}</Typography.Text>

      {Object.entries(grouped).map(([fileType, groupFiles]) => (
        <div key={fileType} style={{ width: '100%', maxWidth: 520 }}>
          <Typography.Text strong style={{ fontSize: 13, textTransform: 'uppercase' }}>
            <Tag color={FILE_TYPE_COLORS[fileType] || 'default'}>
              {typeLabels[fileType] || fileType}
            </Tag>
            {groupFiles.length > 1 && ` (${groupFiles.length})`}
          </Typography.Text>
          <Space orientation="vertical" style={{ width: '100%', marginTop: 8 }}>
            {groupFiles.map((file, idx) => (
              <Card
                key={`${file.original_name}-${idx}`}
                size="small"
                hoverable
                onClick={() => !loading && onLoad(file)}
                style={{ cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Typography.Text
                      strong
                      style={{ fontSize: 13, display: 'block' }}
                      ellipsis
                      title={file.original_name}
                    >
                      <FileOutlined style={{ marginRight: 6 }} />
                      {file.original_name}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {file.format_detected}
                      {file.size_bytes > 0 && ` · ${formatFileSize(file.size_bytes)}`}
                    </Typography.Text>
                  </div>
                  <Button
                    type="primary"
                    size="small"
                    loading={loading}
                    onClick={(e) => {
                      e.stopPropagation()
                      onLoad(file)
                    }}
                  >
                    {t('loadFile')}
                  </Button>
                </div>
              </Card>
            ))}
          </Space>
        </div>
      ))}

      {error && <Alert type="error" title={error} showIcon closable style={{ marginTop: 8 }} />}
    </div>
  )
}

export default PendingFilesView
