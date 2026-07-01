import {
  BugOutlined,
  CodeOutlined,
  FileTextOutlined,
  FileUnknownOutlined,
  GlobalOutlined,
  LineChartOutlined,
  WarningOutlined,
  WifiOutlined,
} from '@ant-design/icons'
import { Card, Collapse, List, Tag, Typography } from 'antd'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { BugreportFileInfo } from '../types'

const { Text } = Typography

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const TYPE_META: Record<string, { icon: React.ReactNode; color: string; labelKey: string }> = {
  log: { icon: <FileTextOutlined />, color: 'green', labelKey: 'bugreport.type.log' },
  pcap: { icon: <GlobalOutlined />, color: 'blue', labelKey: 'bugreport.type.pcap' },
  hci: { icon: <WifiOutlined />, color: 'purple', labelKey: 'bugreport.type.hci' },
  trace: { icon: <LineChartOutlined />, color: 'orange', labelKey: 'bugreport.type.trace' },
  anr: { icon: <WarningOutlined />, color: 'red', labelKey: 'bugreport.type.anr' },
  tombstone: { icon: <BugOutlined />, color: 'volcano', labelKey: 'bugreport.type.tombstone' },
  other: { icon: <FileUnknownOutlined />, color: 'default', labelKey: 'bugreport.type.other' },
}

const TYPE_ORDER = ['log', 'anr', 'tombstone', 'trace', 'pcap', 'hci', 'other'] as const

interface BugreportFileListProps {
  files: BugreportFileInfo[]
  onSelectFile: (file: BugreportFileInfo) => void
}

const BugreportFileList: React.FC<BugreportFileListProps> = ({ files, onSelectFile }) => {
  const { t } = useTranslation()

  const grouped = useMemo(() => {
    const map: Record<string, BugreportFileInfo[]> = {}
    files.forEach((f) => {
      const key = f.classified_type
      if (!map[key]) map[key] = []
      map[key].push(f)
    })
    return map
  }, [files])

  const sortedGroups = useMemo(() => {
    return TYPE_ORDER.filter((type) => grouped[type] && grouped[type].length > 0)
  }, [grouped])

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
        <CodeOutlined style={{ marginRight: 8 }} />
        {t('bugreport.title')}
      </Typography.Title>
      <Typography.Text type="secondary">
        {t('bugreport.extracted', { count: files.length })}
      </Typography.Text>

      <Card size="small" style={{ width: '100%', maxWidth: 560 }}>
        <Collapse
          defaultActiveKey={sortedGroups}
          size="small"
          items={sortedGroups.map((type) => {
            const groupFiles = grouped[type]
            const meta = TYPE_META[type] || TYPE_META.other

            return {
              key: type,
              label: (
                <span>
                  {meta.icon}
                  <Text strong style={{ marginLeft: 6 }}>
                    {t(meta.labelKey)}
                  </Text>
                  <Tag style={{ marginLeft: 8 }}>{groupFiles.length}</Tag>
                </span>
              ),
              children: (
                <List
                  size="small"
                  dataSource={groupFiles}
                  renderItem={(file) => (
                    <List.Item
                      style={{ cursor: 'pointer', padding: '8px 12px' }}
                      onClick={() => onSelectFile(file)}
                      tabIndex={0}
                      role="button"
                      aria-label={file.original_name}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelectFile(file)
                        }
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text
                            style={{ fontSize: 13, display: 'block' }}
                            ellipsis
                            title={file.original_name}
                          >
                            {file.original_name}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {file.path}
                          </Text>
                        </div>
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
                        >
                          <Tag color={meta.color} style={{ fontSize: 11 }}>
                            {t(meta.labelKey)}
                          </Tag>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {formatFileSize(file.size)}
                          </Text>
                        </div>
                      </div>
                    </List.Item>
                  )}
                />
              ),
            }
          })}
        />
      </Card>
    </div>
  )
}

export default BugreportFileList
