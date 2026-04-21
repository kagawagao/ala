import React, { useEffect, useMemo, useState } from 'react'
import { Modal, Checkbox, Typography, Button, Space, Tag, Input, Empty } from 'antd'
import { FileOutlined, FolderOutlined, SearchOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { DirectoryFileInfo } from '../api/logs'

const { Text } = Typography

interface DirectoryFilePickerProps {
  open: boolean
  files: DirectoryFileInfo[]
  dirPath: string
  onConfirm: (selectedFiles: string[]) => void
  onCancel: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const DirectoryFilePicker: React.FC<DirectoryFilePickerProps> = ({
  open,
  files,
  dirPath,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Set<string>>(() => new Set(files.map((f) => f.path)))
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (open) {
      setSelected(new Set(files.map((f) => f.path)))
      setSearch('')
    }
  }, [open, files])

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files
    const lower = search.toLowerCase()
    return files.filter(
      (f) => f.name.toLowerCase().includes(lower) || f.path.toLowerCase().includes(lower),
    )
  }, [files, search])

  // Group files by directory for display
  const groupedFiles = useMemo(() => {
    const groups = new Map<string, DirectoryFileInfo[]>()
    for (const file of filteredFiles) {
      const dir = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '.'
      if (!groups.has(dir)) groups.set(dir, [])
      groups.get(dir)!.push(file)
    }
    // Sort directories: root first, then alphabetical
    const sorted = [...groups.entries()].sort(([a], [b]) => {
      if (a === '.') return -1
      if (b === '.') return 1
      return a.localeCompare(b)
    })
    return sorted
  }, [filteredFiles])

  const allSelected = filteredFiles.length > 0 && filteredFiles.every((f) => selected.has(f.path))
  const someSelected = filteredFiles.some((f) => selected.has(f.path))

  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selected)
      for (const f of filteredFiles) next.delete(f.path)
      setSelected(next)
    } else {
      const next = new Set(selected)
      for (const f of filteredFiles) next.add(f.path)
      setSelected(next)
    }
  }

  const toggleFile = (path: string) => {
    const next = new Set(selected)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setSelected(next)
  }

  return (
    <Modal
      title={t('directoryFilePicker')}
      open={open}
      onCancel={onCancel}
      width={640}
      footer={[
        <Text key="count" style={{ float: 'left', lineHeight: '32px' }}>
          {t('selectedCount', { count: selected.size })}
        </Text>,
        <Button key="cancel" onClick={onCancel}>
          {t('cancel')}
        </Button>,
        <Button
          key="confirm"
          type="primary"
          disabled={selected.size === 0}
          onClick={() => onConfirm([...selected])}
        >
          {t('loadSelected')}
        </Button>,
      ]}
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
        {dirPath}
      </Text>

      <Space style={{ width: '100%', marginBottom: 12 }} direction="vertical" size={8}>
        <Space>
          <Checkbox
            indeterminate={someSelected && !allSelected}
            checked={allSelected}
            onChange={toggleAll}
          >
            {allSelected ? t('deselectAll') : t('selectAll')}
          </Checkbox>
        </Space>
        <Input
          prefix={<SearchOutlined />}
          placeholder={t('search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          size="small"
        />
      </Space>

      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {filteredFiles.length === 0 ? (
          <Empty description={t('noFilesFound')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          groupedFiles.map(([dir, dirFiles]) => (
            <div key={dir} style={{ marginBottom: 8 }}>
              {dir !== '.' && (
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
                  <FolderOutlined style={{ marginRight: 4 }} />
                  {dir}/
                </Text>
              )}
              <div>
                {dirFiles.map((file) => (
                  <div
                    key={file.path}
                    style={{
                      padding: '4px 0',
                      paddingLeft: dir !== '.' ? 20 : 0,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onClick={() => toggleFile(file.path)}
                  >
                    <Checkbox
                      checked={selected.has(file.path)}
                      onChange={() => toggleFile(file.path)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginRight: 8 }}
                    />
                    <FileOutlined style={{ marginRight: 6 }} />
                    <Text style={{ flex: 1, fontSize: 13 }} ellipsis title={file.path}>
                      {file.name}
                    </Text>
                    <Tag style={{ marginLeft: 8, fontSize: 11 }}>{formatFileSize(file.size)}</Tag>
                    {file.name.endsWith('.gz') && (
                      <Tag color="blue" style={{ fontSize: 11 }}>
                        gzip
                      </Tag>
                    )}
                    {file.name.endsWith('.zip') && (
                      <Tag color="orange" style={{ fontSize: 11 }}>
                        zip
                      </Tag>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}

export default DirectoryFilePicker
