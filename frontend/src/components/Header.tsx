import React from 'react'
import { Button, Select, Space, Tag, Tooltip } from 'antd'
import {
  MoonOutlined,
  SunOutlined,
  GlobalOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  WifiOutlined,
  DisconnectOutlined,
  FolderOutlined,
  CodeOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { Project } from '../types'

interface HeaderProps {
  isDark: boolean
  onToggleTheme: () => void
  language: string
  onToggleLanguage: () => void
  onOpenSettings: () => void
  siderCollapsed: boolean
  onToggleSider: () => void
  backendConnected: boolean
  projects: Project[]
  selectedProjectId: string | null
  onProjectChange: (id: string | null) => void
}

const Header: React.FC<HeaderProps> = ({
  isDark,
  onToggleTheme,
  language,
  onToggleLanguage,
  onOpenSettings,
  siderCollapsed,
  onToggleSider,
  backendConnected,
  projects,
  selectedProjectId,
  onProjectChange,
}) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        height: '48px',
        borderBottom: '1px solid var(--ant-color-border)',
      }}
    >
      <Space>
        <Tooltip title={siderCollapsed ? t('showSidebar') : t('hideSidebar')}>
          <Button
            type="text"
            icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={onToggleSider}
          />
        </Tooltip>
        <img src="/ala-icon.svg" alt="ALA" style={{ width: 24, height: 24, borderRadius: 4 }} />
        <span style={{ fontWeight: 700, fontSize: 16 }}>ALA</span>
        <Tag
          color={backendConnected ? 'success' : 'error'}
          icon={backendConnected ? <WifiOutlined /> : <DisconnectOutlined />}
        >
          {backendConnected ? t('connected') : t('disconnected')}
        </Tag>
        {projects.length > 0 && (
          <Select
            size="small"
            placeholder={t('selectProject')}
            value={selectedProjectId}
            onChange={(v) => onProjectChange(v ?? null)}
            allowClear
            style={{ minWidth: 160 }}
            options={projects.map((p) => ({
              value: p.id,
              label: (
                <Space size={4}>
                  <CodeOutlined />
                  {p.name}
                </Space>
              ),
            }))}
          />
        )}
      </Space>
      <Space>
        <Tooltip title={isDark ? t('switchToLightMode') : t('switchToDarkMode')}>
          <Button
            type="text"
            icon={isDark ? <SunOutlined /> : <MoonOutlined />}
            onClick={onToggleTheme}
          />
        </Tooltip>
        <Tooltip title={language === 'en' ? '中文' : 'English'}>
          <Button type="text" icon={<GlobalOutlined />} onClick={onToggleLanguage}>
            {language === 'en' ? 'EN' : '中文'}
          </Button>
        </Tooltip>
        <Tooltip title={t('projectSettings')}>
          <Button type="text" icon={<FolderOutlined />} onClick={() => navigate('/projects')} />
        </Tooltip>
        <Tooltip title={t('settings')}>
          <Button type="text" icon={<SettingOutlined />} onClick={onOpenSettings} />
        </Tooltip>
      </Space>
    </div>
  )
}

export default Header
