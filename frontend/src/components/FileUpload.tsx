import React, { useCallback, useState } from 'react'
import { Upload, Typography, Spin, Alert, List, Tag } from 'antd'
import { InboxOutlined, FileOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { UploadProps } from 'antd'

const { Dragger } = Upload
const { Text } = Typography

interface FileUploadProps {
  onLogFiles: (files: File[]) => void
  onTraceFile: (file: File) => void
  loading: boolean
  error?: string
  fileNames?: string[]
}

const LOG_EXTS = new Set(['.log', '.txt', '.logcat', '.gz', '.zip'])
const TRACE_EXTS = new Set(['.pb', '.json', '.perfetto-trace', '.perfetto'])

function detectFileType(file: File): 'log' | 'trace' | 'unknown' {
  const name = file.name.toLowerCase()
  const lastDot = name.lastIndexOf('.')
  if (lastDot === -1) return 'unknown'
  const ext = name.slice(lastDot)
  if (LOG_EXTS.has(ext)) return 'log'
  if (TRACE_EXTS.has(ext)) return 'trace'
  return 'unknown'
}

const FileUpload: React.FC<FileUploadProps> = ({
  onLogFiles,
  onTraceFile,
  loading,
  error,
  fileNames = [],
}) => {
  const { t } = useTranslation()
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = useCallback(
    (files: File[]) => {
      const logFiles: File[] = []
      let traceFile: File | null = null

      for (const file of files) {
        const type = detectFileType(file)
        if (type === 'trace') {
          traceFile = file
        } else {
          // 'log' or 'unknown' → treat as log
          logFiles.push(file)
        }
      }

      if (traceFile) onTraceFile(traceFile)
      if (logFiles.length > 0) onLogFiles(logFiles)
    },
    [onLogFiles, onTraceFile],
  )

  const props: UploadProps = {
    name: 'file',
    multiple: true,
    showUploadList: false,
    beforeUpload: (_file, fileList) => {
      // Called once per selected file but fileList contains all selected files.
      // We only want to trigger once; use the first call with the full list.
      if (fileList[0] === _file) {
        handleFiles(fileList as File[])
      }
      return false
    },
    onDrop: (e) => {
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) handleFiles(files)
    },
  }

  return (
    <div
      style={{ padding: '16px' }}
      onDragOver={() => setDragOver(true)}
      onDragLeave={() => setDragOver(false)}
    >
      <Dragger
        {...props}
        disabled={loading}
        style={{
          background: dragOver ? 'var(--ant-color-primary-bg)' : undefined,
          transition: 'background 0.2s',
        }}
      >
        <p className="ant-upload-drag-icon">
          {loading ? <Spin size="large" /> : <InboxOutlined />}
        </p>
        <p className="ant-upload-text">{loading ? t('loadingFile') : t('dragAndDrop')}</p>
        <p className="ant-upload-hint">{t('supportedFormats')}</p>
      </Dragger>

      {fileNames.length > 0 && !loading && (
        <List
          size="small"
          style={{ marginTop: 8 }}
          dataSource={fileNames}
          renderItem={(name) => (
            <List.Item style={{ padding: '2px 0' }}>
              <FileOutlined style={{ marginRight: 6 }} />
              <Text type="success" style={{ fontSize: 12 }}>
                {name}
              </Text>
              {name.endsWith('.gz') && (
                <Tag color="blue" style={{ marginLeft: 4, fontSize: 11 }}>
                  gzip
                </Tag>
              )}
              {name.endsWith('.zip') && (
                <Tag color="orange" style={{ marginLeft: 4, fontSize: 11 }}>
                  zip
                </Tag>
              )}
            </List.Item>
          )}
        />
      )}

      {error && <Alert type="error" message={error} style={{ marginTop: 12 }} showIcon closable />}
    </div>
  )
}

export default FileUpload
