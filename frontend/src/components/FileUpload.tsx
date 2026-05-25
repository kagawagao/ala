import React, { useCallback, useState } from 'react'
import { Upload, Typography, Spin, Alert, Tag, Input, Button, Space, Divider } from 'antd'
import { InboxOutlined, FileOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { UploadProps } from 'antd'

const { Dragger } = Upload
const { Text } = Typography

interface FileUploadProps {
  onFiles: (files: File[]) => void
  onLocalPath?: (path: string) => void
  loading: boolean
  error?: string
  fileNames?: string[]
  compact?: boolean
}

const FileUpload: React.FC<FileUploadProps> = ({
  onFiles,
  onLocalPath,
  loading,
  error,
  fileNames = [],
  compact = false,
}) => {
  const { t } = useTranslation()
  const [dragOver, setDragOver] = useState(false)
  const [inputPath, setInputPath] = useState('')
  const [inputLoading, setInputLoading] = useState(false)
  const [scanError, setScanError] = useState<string>()

  const handlePathSubmit = useCallback(
    (path: string) => {
      setScanError(undefined)
      onLocalPath?.(path)
      setInputPath('')
    },
    [onLocalPath],
  )

  const props: UploadProps = {
    name: 'file',
    multiple: true,
    showUploadList: false,
    beforeUpload: (_file, fileList) => {
      if (fileList[0] === _file) {
        onFiles(fileList as File[])
      }
      return false
    },
    onDrop: () => {
      setDragOver(false)
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
        <div style={{ marginBottom: 8 }}>
          {fileNames.map((name, idx) => {
            const displayName = name.replace(/\\/g, '/').split('/').pop() || name
            return (
              <div
                key={`${name}-${idx}`}
                style={{ padding: '2px 0', display: 'flex', alignItems: 'center' }}
              >
                <FileOutlined style={{ marginRight: 6 }} />
                <Text style={{ fontSize: 12 }} ellipsis title={name}>
                  {displayName}
                </Text>
              </div>
            )
          })}
        </div>
      )}

      <Dragger
        {...props}
        disabled={loading}
        style={{
          background: dragOver ? 'var(--ant-color-primary-bg)' : undefined,
          transition: 'background 0.2s',
        }}
      >
        <div className="ant-upload-drag-icon" style={{ margin: compact ? '8px 0' : undefined }}>
          {loading ? <Spin size={compact ? 'default' : 'large'} /> : <InboxOutlined />}
        </div>
        <div
          className="ant-upload-text"
          style={{ fontSize: compact ? 13 : undefined, margin: compact ? '4px 0' : undefined }}
        >
          {loading ? t('loadingFile') : t('dragAndDrop')}
        </div>
        {!compact && <div className="ant-upload-hint">{t('supportedFormats')}</div>}
      </Dragger>

      {/* Local path input — path passed directly to agent for autonomous file discovery */}
      {!compact && onLocalPath && (
        <>
          <Divider style={{ margin: '12px 0', fontSize: 12 }}>{t('orEnterLocalFilePath')}</Divider>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="/path/to/logs (file or directory)"
              prefix={<FolderOpenOutlined />}
              value={inputPath}
              onChange={(e) => setInputPath(e.target.value)}
              onPressEnter={() => {
                if (inputPath.trim()) {
                  handlePathSubmit(inputPath.trim())
                }
              }}
              disabled={loading}
            />
            <Button
              type="primary"
              onClick={() => {
                if (inputPath.trim()) {
                  handlePathSubmit(inputPath.trim())
                }
              }}
              disabled={!inputPath.trim() || loading}
            >
              {t('loadLogs')}
            </Button>
          </Space.Compact>
        </>
      )}

      {!compact && fileNames.length > 0 && !loading && (
        <div style={{ marginTop: 8 }}>
          {fileNames.map((name, idx) => {
            const displayName = name.replace(/\\/g, '/').split('/').pop() || name
            return (
              <div
                key={`${name}-${idx}`}
                style={{ padding: '2px 0', display: 'flex', alignItems: 'center' }}
              >
                <FileOutlined style={{ marginRight: 6 }} />
                <Text type="success" style={{ fontSize: 12 }}>
                  {displayName}
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
              </div>
            )
          })}
        </div>
      )}

      {(error || scanError) && (
        <Alert
          type="error"
          message={error || scanError}
          style={{ marginTop: 12 }}
          showIcon
          closable
          onClose={() => setScanError(undefined)}
        />
      )}
    </div>
  )
}

export default FileUpload
