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
  compact?: boolean
}

/**
 * Detect file type by reading the first bytes (magic bytes) of the file.
 * Falls back to heuristics for text files.
 */
async function detectFileTypeByHeader(file: File): Promise<'log' | 'trace'> {
  try {
    const slice = file.slice(0, 512)
    const buf = await slice.arrayBuffer()
    const bytes = new Uint8Array(buf)

    // GZ magic: 1F 8B → gzip-compressed → treat as log (gzipped logcat)
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return 'log'

    // ZIP magic: PK (50 4B) → zip archive → treat as log (zipped logs)
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'log'

    // Count non-printable bytes in the first 128 bytes to distinguish binary from text.
    // Allowlist: TAB (09), LF (0A), CR (0D), and printable ASCII (20-7E).
    let nonPrintable = 0
    const checkLen = Math.min(bytes.length, 128)
    for (let i = 0; i < checkLen; i++) {
      const b = bytes[i]
      if (b !== 0x09 && b !== 0x0a && b !== 0x0d && (b < 0x20 || b > 0x7e)) {
        nonPrintable++
      }
    }
    const isBinary = nonPrintable > 4

    if (isBinary) {
      // Binary file → likely a Perfetto/proto trace
      return 'trace'
    }

    // Text file: check for JSON trace signature
    const text = new TextDecoder().decode(bytes)
    const trimmed = text.trimStart()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      if (
        text.includes('traceEvents') ||
        text.includes('systemTraceEvents') ||
        text.includes('"displayTimeUnit"')
      ) {
        return 'trace'
      }
    }

    // Default: treat as plain text log
    return 'log'
  } catch {
    // If we can't read the file, fall back to extension
    const name = file.name.toLowerCase()
    if (name.endsWith('.pb') || name.endsWith('.perfetto-trace') || name.endsWith('.perfetto')) {
      return 'trace'
    }
    return 'log'
  }
}

const FileUpload: React.FC<FileUploadProps> = ({
  onLogFiles,
  onTraceFile,
  loading,
  error,
  fileNames = [],
  compact = false,
}) => {
  const { t } = useTranslation()
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = useCallback(
    async (files: File[]) => {
      const logFiles: File[] = []
      let traceFile: File | null = null

      for (const file of files) {
        const type = await detectFileTypeByHeader(file)
        if (type === 'trace') {
          traceFile = file
        } else {
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
      if (fileList[0] === _file) {
        void handleFiles(fileList as File[])
      }
      return false
    },
    onDrop: (e) => {
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) void handleFiles(files)
    },
  }

  return (
    <div
      style={{ padding: compact ? '8px' : '16px' }}
      onDragOver={() => setDragOver(true)}
      onDragLeave={() => setDragOver(false)}
    >
      {/* Show currently loaded files above the dragger when in compact mode */}
      {compact && fileNames.length > 0 && (
        <List
          size="small"
          style={{ marginBottom: 8 }}
          dataSource={fileNames}
          renderItem={(name) => (
            <List.Item style={{ padding: '2px 0' }}>
              <FileOutlined style={{ marginRight: 6 }} />
              <Text style={{ fontSize: 12 }} ellipsis title={name}>
                {name}
              </Text>
            </List.Item>
          )}
        />
      )}

      <Dragger
        {...props}
        disabled={loading}
        style={{
          background: dragOver ? 'var(--ant-color-primary-bg)' : undefined,
          transition: 'background 0.2s',
        }}
      >
        <p className="ant-upload-drag-icon" style={{ margin: compact ? '8px 0' : undefined }}>
          {loading ? <Spin size={compact ? 'default' : 'large'} /> : <InboxOutlined />}
        </p>
        <p
          className="ant-upload-text"
          style={{ fontSize: compact ? 13 : undefined, margin: compact ? '4px 0' : undefined }}
        >
          {loading ? t('loadingFile') : t('dragAndDrop')}
        </p>
        {!compact && <p className="ant-upload-hint">{t('supportedFormats')}</p>}
      </Dragger>

      {!compact && fileNames.length > 0 && !loading && (
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
