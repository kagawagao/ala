import React, { useCallback, useState } from 'react'
import { Upload, Typography, Spin, Alert, Tag, Input, Button, Space, Divider } from 'antd'
import { InboxOutlined, FileOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { UploadProps } from 'antd'
import DirectoryFilePicker from './DirectoryFilePicker'
import { listDirectoryFiles, parseLocalPath } from '../api/logs'
import type { DirectoryFileInfo } from '../api/logs'

const { Dragger } = Upload
const { Text } = Typography

interface FileUploadProps {
  onLogFiles: (files: File[]) => void
  onTraceFile: (file: File) => void
  onDirectoryPath?: (path: string) => void
  onSelectedFiles?: (dirPath: string, files: string[]) => void
  onLocalFilePath?: (path: string, fileRef: import('../types').LocalFileRef) => void
  loading: boolean
  error?: string
  fileNames?: string[]
  compact?: boolean
}

/**
 * Detect file type by reading the first bytes (magic bytes / header) of the
 * file.  Falls back to extension-based heuristics when the content is
 * inconclusive.
 *
 * Design decisions
 * ─────────────────
 * 1. GZ / ZIP magic bytes are checked first so that compressed log archives
 *    are never mistaken for binary trace files.
 *
 * 2. "Binary" detection counts only ASCII control bytes (0x00–0x1F, excluding
 *    TAB / LF / CR).  We deliberately do NOT count high bytes (0x80–0xFF)
 *    because those are valid UTF-8 continuation bytes and appear in every
 *    logcat file that contains CJK characters.  Protobuf field-tag bytes
 *    (e.g. 0x08, 0x12, 0x18 …) are below 0x20 and accumulate quickly, so a
 *    threshold of > 4 reliably separates binary proto traces from text logs.
 *
 * 3. The JSON-signature search window is 8 KB (not 512 B) so that trace files
 *    whose `traceEvents` key is preceded by a long metadata object are still
 *    correctly identified.
 *
 * 4. If content analysis is inconclusive, the file extension is used as a
 *    tiebreaker, preserving the original backward-compatible behaviour.
 */
async function detectFileTypeByHeader(file: File): Promise<'log' | 'trace'> {
  const name = file.name.toLowerCase()
  const lastDot = name.lastIndexOf('.')
  const ext = lastDot !== -1 ? name.slice(lastDot) : ''

  const TRACE_EXTS = new Set(['.pb', '.json', '.perfetto-trace', '.perfetto'])
  const LOG_EXTS = new Set(['.log', '.txt', '.logcat', '.gz', '.zip'])

  try {
    const slice = file.slice(0, 8 * 1024) // Read up to 8 KB
    const buf = await slice.arrayBuffer()
    const bytes = new Uint8Array(buf)

    if (bytes.length === 0) {
      return TRACE_EXTS.has(ext) ? 'trace' : 'log'
    }

    // ── Magic bytes ────────────────────────────────────────────────────────
    // GZ: 1F 8B  →  gzip-compressed → log (gzipped logcat / ZIP of logs)
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return 'log'
    // ZIP: 50 4B  →  zip archive → log
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'log'

    // ── Binary detection ───────────────────────────────────────────────────
    // Count ASCII control bytes (< 0x20) excluding the three common
    // whitespace controls: TAB (0x09), LF (0x0A), CR (0x0D).
    // High bytes (0x80–0xFF) are NOT counted – they are valid UTF-8.
    let controlBytes = 0
    const scanLen = Math.min(bytes.length, 256)
    for (let i = 0; i < scanLen; i++) {
      const b = bytes[i]
      if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
        controlBytes++
      }
    }
    if (controlBytes > 4) {
      // Binary file – very likely a Perfetto proto trace
      return 'trace'
    }

    // ── Text file: JSON trace signature scan ───────────────────────────────
    const text = new TextDecoder().decode(bytes)
    const trimmed = text.trimStart()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      if (
        text.includes('"traceEvents"') ||
        text.includes('"systemTraceEvents"') ||
        text.includes('"displayTimeUnit"') ||
        text.includes('"ph"') // Chrome Trace Event Format
      ) {
        return 'trace'
      }
    }

    // ── Extension fallback ─────────────────────────────────────────────────
    // If the content analysis is inconclusive, trust the file extension so
    // that known trace / log file types are always routed correctly.
    if (TRACE_EXTS.has(ext)) return 'trace'
    if (LOG_EXTS.has(ext)) return 'log'

    // Unknown extension with text content → treat as log
    return 'log'
  } catch {
    // Unable to read the file – pure extension fallback
    if (TRACE_EXTS.has(ext)) return 'trace'
    return 'log'
  }
}

const FileUpload: React.FC<FileUploadProps> = ({
  onLogFiles,
  onTraceFile,
  onDirectoryPath,
  onSelectedFiles,
  onLocalFilePath,
  loading,
  error,
  fileNames = [],
  compact = false,
}) => {
  const { t } = useTranslation()
  const [dragOver, setDragOver] = useState(false)
  const [dirPath, setDirPath] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [localPathLoading, setLocalPathLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerFiles, setPickerFiles] = useState<DirectoryFileInfo[]>([])
  const [pickerDirPath, setPickerDirPath] = useState('')
  const [scanError, setScanError] = useState<string>()

  const FILE_COUNT_THRESHOLD = 50

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

  const handleDirectorySubmit = useCallback(
    async (path: string) => {
      setScanError(undefined)
      setScanning(true)
      try {
        const result = await listDirectoryFiles(path)
        if (result.total_files === 0) {
          setScanError(t('noFilesFound'))
          return
        }
        // Show picker when there are many files or subdirectories
        if (result.total_files > FILE_COUNT_THRESHOLD || result.has_subdirectories) {
          setPickerFiles(result.files)
          setPickerDirPath(path)
          setPickerOpen(true)
        } else {
          // Few files, flat directory – load all directly
          onDirectoryPath?.(path)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : t('parseError')
        setScanError(msg)
      } finally {
        setScanning(false)
      }
    },
    [onDirectoryPath, t],
  )

  const handleLocalPathSubmit = useCallback(
    async (path: string) => {
      if (!onLocalFilePath) return
      setLocalPathLoading(true)
      setScanError(undefined)
      try {
        const ref = await parseLocalPath(path)
        onLocalFilePath(path, ref)
        setLocalPath('')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to load file'
        setScanError(msg)
      } finally {
        setLocalPathLoading(false)
      }
    },
    [onLocalFilePath],
  )

  const handlePickerConfirm = useCallback(
    (selectedFiles: string[]) => {
      setPickerOpen(false)
      if (onSelectedFiles) {
        onSelectedFiles(pickerDirPath, selectedFiles)
      } else {
        // Fallback: load entire directory
        onDirectoryPath?.(pickerDirPath)
      }
    },
    [onSelectedFiles, onDirectoryPath, pickerDirPath],
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
          {fileNames.map((name) => (
            <div key={name} style={{ padding: '2px 0', display: 'flex', alignItems: 'center' }}>
              <FileOutlined style={{ marginRight: 6 }} />
              <Text style={{ fontSize: 12 }} ellipsis title={name}>
                {name}
              </Text>
            </div>
          ))}
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

      {/* Local file path input (FEAT-LAZY-LOG) */}
      {!compact && onLocalFilePath && (
        <>
          <Divider style={{ margin: '12px 0', fontSize: 12 }}>
            {t('orEnterLocalFilePath') || 'Or enter a local file path'}
          </Divider>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="/path/to/logcat.log"
              prefix={<FileOutlined />}
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              onPressEnter={() => {
                if (localPath.trim()) {
                  void handleLocalPathSubmit(localPath.trim())
                }
              }}
              disabled={loading || localPathLoading}
            />
            <Button
              type="primary"
              onClick={() => {
                if (localPath.trim()) {
                  void handleLocalPathSubmit(localPath.trim())
                }
              }}
              disabled={!localPath.trim() || loading || localPathLoading}
              loading={localPathLoading}
            >
              {t('analyze') || 'Analyze'}
            </Button>
          </Space.Compact>
        </>
      )}

      {/* Log directory input */}
      {!compact && onDirectoryPath && (
        <>
          <Divider style={{ margin: '12px 0', fontSize: 12 }}>{t('orLoadFromDirectory')}</Divider>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder={t('logDirectoryPlaceholder')}
              prefix={<FolderOpenOutlined />}
              value={dirPath}
              onChange={(e) => setDirPath(e.target.value)}
              onPressEnter={() => {
                if (dirPath.trim()) {
                  void handleDirectorySubmit(dirPath.trim())
                }
              }}
              disabled={loading || scanning}
            />
            <Button
              type="primary"
              onClick={() => {
                if (dirPath.trim()) {
                  void handleDirectorySubmit(dirPath.trim())
                }
              }}
              disabled={!dirPath.trim() || loading || scanning}
              loading={loading || scanning}
            >
              {scanning ? t('directoryScanning') : t('loadLogs')}
            </Button>
          </Space.Compact>
        </>
      )}

      {!compact && fileNames.length > 0 && !loading && (
        <div style={{ marginTop: 8 }}>
          {fileNames.map((name) => (
            <div key={name} style={{ padding: '2px 0', display: 'flex', alignItems: 'center' }}>
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
            </div>
          ))}
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

      <DirectoryFilePicker
        open={pickerOpen}
        files={pickerFiles}
        dirPath={pickerDirPath}
        onConfirm={handlePickerConfirm}
        onCancel={() => setPickerOpen(false)}
      />
    </div>
  )
}

export default FileUpload
