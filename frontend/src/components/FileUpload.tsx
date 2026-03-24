import React, { useCallback, useRef, useState } from 'react'
import { Upload, Typography, Spin, Alert } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { UploadProps } from 'antd'

const { Dragger } = Upload
const { Text } = Typography

interface FileUploadProps {
  onLogFile: (file: File) => void
  onTraceFile: (file: File) => void
  loading: boolean
  error?: string
  fileName?: string
}

const LOG_EXTS = ['.log', '.txt']
const TRACE_EXTS = ['.pb', '.json', '.perfetto-trace']

function detectFileType(file: File): 'log' | 'trace' | null {
  const name = file.name.toLowerCase()
  if (LOG_EXTS.some((ext) => name.endsWith(ext))) return 'log'
  if (TRACE_EXTS.some((ext) => name.endsWith(ext))) return 'trace'
  return null
}

const FileUpload: React.FC<FileUploadProps> = ({
  onLogFile,
  onTraceFile,
  loading,
  error,
  fileName,
}) => {
  const { t } = useTranslation()
  const [dragOver, setDragOver] = useState(false)
  const uploadRef = useRef<HTMLDivElement>(null)

  const handleFile = useCallback(
    (file: File) => {
      const type = detectFileType(file)
      if (type === 'log') {
        onLogFile(file)
      } else if (type === 'trace') {
        onTraceFile(file)
      } else {
        // Try to detect by content — default to log
        onLogFile(file)
      }
    },
    [onLogFile, onTraceFile],
  )

  const props: UploadProps = {
    name: 'file',
    multiple: false,
    showUploadList: false,
    beforeUpload: (file) => {
      handleFile(file)
      return false
    },
    onDrop: (e) => {
      setDragOver(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
  }

  return (
    <div
      ref={uploadRef}
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
        {fileName && !loading && (
          <Text type="success" style={{ fontSize: 12 }}>
            ✓ {fileName}
          </Text>
        )}
      </Dragger>
      {error && <Alert type="error" message={error} style={{ marginTop: 12 }} showIcon closable />}
    </div>
  )
}

export default FileUpload
